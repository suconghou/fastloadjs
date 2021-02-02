import { fastConfig, httpResponse, dispatcher } from "./types";
import bufferController from './buffer'
import dispatch from "./dispatch";
import stream from "./stream";
import workers from "./workers/index";
import tasks from "./tasks/index";
import { event } from './utils/util'
import libwebrtc from '/Users/admin/data/git/repo/rtc/static/js/data'

const iceServers = {
	"iceServers": [
		{
			urls: "stun:119.29.1.39:3478",
		},
		{
			urls: "turn:119.29.1.39:3478",
			username: "su",
			credential: "su"
		},
	]
};

let rtc: libwebrtc;

export default class fastload extends event {

	protected config: fastConfig;

	private stream: stream
	public dispatcher: dispatcher

	private worker: workers

	private err: any

	private defaultOpts = {
		retry: 5,
		thread: 2,
		thunk: 524288,
	}

	// 由外部注入,提供直接操作sourceBuffer的入口
	public refBuffer: bufferController

	private rtcLoop: number;

	private rtcEvcancel: Function = () => { }

	constructor(opts: fastConfig) {
		super()
		this.config = Object.assign({}, this.defaultOpts, opts)

		if (!this.config.nop2p && !rtc && window.RTCPeerConnection) {
			rtc = new libwebrtc(iceServers)
			rtc.init()
		}
	}

	public start(pause: boolean) {
		const { thread, thunk, start, end, retry } = this.config
		if (!this.dispatcher) {
			this.dispatcher = new dispatch(thunk, Number(start), Number(end))
		}

		this.stream = new stream(null, false)

		this.worker = new workers(thread, retry, (res: httpResponse) => {
			return this.taskDone(res)
		}, () => {
			this.taskFinish()
		})
		this.worker.pause = pause

		let i = 0
		while (i < thread) {
			const item = this.dispatcher.next()
			// 如果没有下一个说明任务都派发完了
			if (item) {
				this.worker.push(this.taskWrap(item))
			}
			i++;
		}
		if (!this.config.nop2p && window.RTCPeerConnection) {
			if (!this.rtcLoop && pause !== false && this.config.meta != this.config.req) {
				this.rtcLoop = setTimeout(() => this.rtcInit(), 1e3)
			}
		}
		return this;
	}

	public pause(pause: boolean) {
		if (this.worker) {
			this.worker.pause = pause
		}
	}

	public destroy() {
		this.remove('')
		this.pause(true)
		this.stream.destroy();
		this.stream = null
		this.rtcReset()
		if (this.refBuffer) {
			this.refBuffer.q.clear()
			this.refBuffer = null
		}
	}

	// 此处需要根据时间,判断出所在的segment
	public seekTo(time: number) {
		this.pause(false);
		const segmentsMap = this.dispatcher.getMap();
		const len = this.dispatcher.total;
		for (let i = 0; i < len; i++) {
			const item = segmentsMap[i];
			if (item.begin >= time) {
				const index = Math.max(i - 1, 0)
				this.dispatcher.seekTo(index);
				this.cachefill(index);
				return;
			}
		}
	}

	// 如果是seek到之前已释放的buffer,此处需要fill回来
	// buffer数据从stream中拿,
	private cachefill(index: number) {
		const len = this.dispatcher.total;
		let cleared = false
		for (let i = index; i < len; i++) {
			const buffer = this.stream.item(i)
			if (!buffer || buffer.err || !buffer.data) {
				break
			}
			if (!cleared) {
				this.refBuffer.q.clear()
				cleared = true
			}
			this.refBuffer.repush(buffer.data)
		}
	}

	// 处理mirrors负载策略
	private taskWrap(item: any): Function {
		const { m, n, no } = item
		let i = 0;
		const used: Array<RequestInfo> = []
		const urlFn = () => {
			i++
			const mirrors = [this.config.req].concat(this.config.mirrors)
			// 首次使用取余算法,固定的分片序号被分配到固定的镜像上,首位镜像有较高权重
			let u = mirrors[no % mirrors.length]
			if (i <= 1) {
				used.push(u)
				return u
			}
			// 重试时排除之前使用的镜像然后在剩余镜像里随机
			u = this.getBestURL(mirrors, used);
			used.push(u)
			return u
		}
		return tasks.wrap(this.config.retry, urlFn, m, n, no, this.stream)
	}

	// 这个是第二次及以后重试的,排除之前使用的,然后在剩余里随机,如果都使用过,则重新随机
	private getBestURL(mirrors: RequestInfo[], used: RequestInfo[]): RequestInfo {
		const m = mirrors.filter(item => !used.includes(item))
		if (m.length) {
			return m[Math.floor(Math.random() * m.length)]
		}
		return mirrors[Math.floor(Math.random() * mirrors.length)]
	}

	// 一个任务完成了,收集这个任务结果,然后派发下个任务,如果任务出错,则终止
	// 需要反馈给dispatch,以便dispatch查漏
	private taskDone(res: httpResponse) {
		if (!this.stream) {
			// 如果stream都没有了,说明早已destroy了,发出终止信号
			return true
		}
		// 这里都是http的执行结果,res有可能是检测到rtc已OK,放弃执行的
		// 仅当此任务之前没有执行结果,才使用本次结果
		const a = this.stream.item(res.no)
		if (!a) {
			this.stream.push(res.no, res)
			setTimeout(() => {
				this.trigger('res.done', res)
			}, 200)
		}
		this.dispatcher.done(res.no);
		if (!this.config.nop2p && window.RTCPeerConnection && this.config.meta != this.config.req) {
			// 不是indexRange的请求才使用rtc;仅当已持有正确数据或当前未出错才回应
			if ((a && !a.err) || (res.data && !res.err)) {
				rtc.found(this.config.meta, res.no)
			}
		}

		if (!a && res.err) {
			// 仅当我们使用此结果是我们才关系其错误;经过了多次retry后任然出错,全部终止,事件会通知到上级,需显示错误页面
			this.err = res.err
			return true
		}
		if (this.err) {
			// 一旦出错,不能跳过,必须全部终止
			return true;
		}

		const item = this.dispatcher.next()
		if (item) {
			this.worker.push(this.taskWrap(item))
			this.trigger('res.start', item)
		} else {
			// 没有任务了,发出终止信息
			return true
		}
	}


	private taskFinish() {
		if (!this.stream) {
			// 已经被destroy了
			return
		}
		this.stream.push(this.dispatcher.total, { done: true, data: null, err: null, no: 1e9 })
	}

	private rtcInit() {
		clearTimeout(this.rtcLoop)
		const query = (no: number) => {
			rtc.query(
				this.config.meta,
				no,
				(id: string, index: number) => {
					if (!this.stream) {
						return
					}
					const item = this.stream.item(index)
					return item ? item.data : item
				}
			)
		}
		query(0)
		const hasAlivePeer = (stat: any): Boolean => {
			for (let item of stat) {
				if (item.state == 'open') {
					return true
				}
			}
			return false;
		}
		const task = () => {
			const item = this.dispatcher.rtcNext()
			const stat = rtc.getStats()
			this.trigger('rtc.stat', stat, rtc.id)
			if (!item) {
				// 没有任务了,终止搜寻,但仍更新统计数据
				this.rtcLoop = setTimeout(task, 2e3)
				return
			}
			if (hasAlivePeer(stat)) {
				query(item.no)
				item.rstart = true
				this.trigger('res.rtc.start', item)
			}
			this.rtcLoop = setTimeout(task, 2e3 + 100 * this.dispatcher.rtcWaitCount)
		}
		this.rtcLoop = setTimeout(task, 2e3)
		this.rtcEvcancel = this.rtcEventInit()
	}

	private rtcEventInit(): Function {
		const events: Array<Function> = [];
		const bufferProgress = ({ id, i, n, uid }) => {
			// 传输进行中
			const [idtag, index] = id.split('|')
			if (this.config.meta != idtag) {
				// rtc实例是共享的,非本loader的数据忽略
				return;
			}
			this.trigger('res.rtc.progress', { i, n, uid, no: index, })
		}
		rtc.listen('buffer.progress', bufferProgress)
		events.push(() => {
			rtc.remove('buffer.progress', bufferProgress)
		})
		const data = ({ id, index, buffer }) => {
			const item: httpResponse = {
				no: index,
				data: buffer,
				err: null,
			}
			if (!this.stream) {
				return
			}
			if (this.config.meta != id) {
				return;
			}
			const a = this.stream.item(index)
			if (!a || a.err) {
				this.stream.push(item.no, item)
				rtc.found(this.config.meta, item.no)
				this.trigger('res.rtc.done', item)
			}
			this.dispatcher.done(item.no)
		}
		rtc.listen('data', data)
		events.push(() => {
			rtc.remove('data', data)
		})
		const statsUpdate = () => {
			const stat = rtc.getStats()
			this.trigger('rtc.stat', stat)
		}
		rtc.listen('open', statsUpdate)
		events.push(() => {
			rtc.remove('open', statsUpdate)
		})
		rtc.listen('close', statsUpdate)
		events.push(() => {
			rtc.remove('close', statsUpdate)
		})
		rtc.listen('error', statsUpdate)
		events.push(() => {
			rtc.remove('error', statsUpdate)
		})
		const destroy = () => {
			for (let fn of events) {
				fn();
			}
		}
		return destroy
	}

	private rtcReset() {
		clearTimeout(this.rtcLoop)
		this.rtcEvcancel()
		if (rtc) {
			rtc.clear()
		}
	}

	getResponse(): Response {
		return this.stream.getResponse();
	}

	static rtc() {
		if (!rtc) {
			rtc = new libwebrtc(iceServers)
			rtc.init()
		}
		return rtc
	}
}
