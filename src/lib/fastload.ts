import { fastConfig, partResponse, taskItem, fetchTask, objectMap } from "./types";
import bufferController from './buffer'
import workers from "./workers/index";
import tasks from "./tasks/index";
import dispatcher from './dispatcher'
import { event, sleep } from './utils/util'
import libwebrtc from '../libwebrtc/index'
import { globalBuffer } from "./utils/bufferCenter";

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


export default class fastload extends event {

	private static rtcInstance: libwebrtc;

	protected config: fastConfig;

	public dispatcher: dispatcher

	private worker: workers

	private err: Error

	private defaultOpts = {
		retry: 5,
		thread: 2,
		wsize: 12,
	}

	// 由外部注入,提供直接操作sourceBuffer的入口
	private bufferCtrl: bufferController

	private rtcLoop: number;

	private rtcEvcancel: Function = () => { }

	private rtcFound: number = 0;

	private bufferHealth: number = 0;

	private bufferInuse: Set<number> = new Set()

	private httpPendings: objectMap<number> = {}

	private rtcPendings: objectMap<number> = {}

	constructor(opts: fastConfig) {
		super()
		this.config = { ...this.defaultOpts, ...opts }
		if (this.config.p2p && window.RTCPeerConnection) {
			fastload.rtc()
		}
	}

	// 此API仅调能用一次
	public init(bufferCtrl: bufferController): this {
		const { thread, retry } = this.config
		if (!this.dispatcher) {
			throw new Error('must set dispatcher before start')
		}
		this.bufferCtrl = bufferCtrl
		bufferCtrl.listen('pause', () => {
			// buffer is full
			this.pause(true)
			this.bufferInuse.clear()
		})
		this.worker = new workers(thread, retry, (res: partResponse) => this.taskDone(res))
		if (this.config.p2p && window.RTCPeerConnection) {
			this.rtcLoop = setTimeout(() => this.rtcInit(), 0)
		}
		for (let i = 0; i < thread; i++) {
			// 开启相应的线程数
			this.worker.push(async (): Promise<partResponse> => {
				return { no: -1, data: null, err: null };
			})
		}
		return this;
	}

	private check(no: number): boolean {
		const buf = globalBuffer.get(this.config.meta, no)
		if (!buf) {
			return false
		}
		if (!this.bufferInuse.has(no)) {
			this.bufferCtrl.push(buf.buffer)
			this.bufferInuse.add(no)
		}
		return true
	}

	public pause(pause: boolean) {
		if (this.worker) {
			if (pause) {
				this.worker.pause()
			} else {
				this.worker.start();
			}
		}
	}

	public setBufferHealth(t: number) {
		this.bufferHealth = t;
	}

	public destroy() {
		this.remove('')
		this.pause(true)
		this.rtcReset()
		if (this.bufferCtrl) {
			this.bufferCtrl.destroy()
			this.bufferCtrl = null
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
				return;
			}
		}
	}

	// 封装为闭包任务
	private taskWrap(item: taskItem, fn: Function): fetchTask {
		const task = tasks.wrap(item, this.config.meta, this.config.retry, this.config.req, this.config.mirrors)
		return async (): Promise<partResponse> => {
			fn()
			return await task()
		}
	}

	// 一个任务完成了,收集这个任务结果,然后派发下个任务,如果任务出错,则终止
	// 我们始终应返回false,除非destroy或错误
	private async taskDone(res: partResponse): Promise<boolean> {
		delete this.httpPendings[res.no]
		delete this.rtcPendings[res.no]
		if (!this.bufferCtrl) {
			// 如果bufferCtrl都没有了,说明早已destroy了,发出终止信号
			return true
		}
		if (res.no < 0) {
			// 是我们轮询的空任务,就继续检测下次任务
			return this.triggerNextTask();
		}
		if (this.err) {
			// 一旦出错,不能跳过,必须全部终止,TODO show error
			return true;
		}
		let buffer: ArrayBuffer
		// 如果任务成功，则必然已加入globalBuffer，仅当任务失败时，globalBuffer才查询不到
		if (res.data) {
			// 此处统计当 任务执行时，rtc已完成，或者任务超时，rtc已完成，虽然返回了buffer,但是统计信息不应记http
			this.trigger('http.done', res)
			buffer = res.data
		} else {
			// 看看rtc是否已完成了
			const buf = globalBuffer.get(this.config.meta, res.no)
			if (!buf) {
				// 任务错误了，全局buffer里也没有，这是重试多次也失败，只能终止
				this.err = res.err
				return true
			}
			buffer = buf.buffer
		}
		if (!this.bufferInuse.has(res.no)) {
			this.bufferCtrl.push(buffer)
			this.bufferInuse.add(res.no)
		}
		if (this.config.p2p && window.RTCPeerConnection) {
			const rtc = fastload.rtc()
			rtc.found(this.config.meta, res.no)
		}
		return this.triggerNextTask();
	}

	private async triggerNextTask(): Promise<boolean> {
		// 当buffer充足时,并且当前资源有rtc,我们派发下一个任务慢一下,使http少工作一些,最大可能发挥P2P
		if (this.rtcFound && this.bufferHealth > 15) {
			await sleep(1e3 * (this.bufferHealth / 30)) // 每30秒buffer换取1秒延时
		}
		const items: Array<taskItem> = this.dispatcher.next(this.config.wsize + this.config.thread, this.check)
		if (!items.length) {
			// 全部buffer都已存在，只能表明当前window下,没有需要发起请求的了,我们空轮询
			this.worker.push(async (): Promise<partResponse> => {
				await sleep(200)
				return { no: -1, data: null, err: null };
			})
			return false
		}
		if (!this.rtcFound) {
			// 资源没有发现rtc,我们按照最左侧抢占
			let ctask: taskItem
			for (const item of items) {
				if (!this.httpPendings[item.no]) {
					ctask = item;
					break
				}
			}
			if (ctask) {
				this.worker.push(this.taskWrap(ctask, () => {
					this.trigger('http.start', ctask)
					this.httpPendings[ctask.no] = Date.now()
				}))
				this.httpPendings[ctask.no] = 1
				return false;
			}
			this.worker.push(async (): Promise<partResponse> => {
				await sleep(200)
				return { no: -1, data: null, err: null };
			})
			return false;
		}
		// 如果发现此资源存在rtc,我们查询rtc抢占后剩余哪些任务
		let nextItem: taskItem;
		const t = Date.now()
		for (const item of items) {
			// http 已经抢占的必然跳过
			if (this.httpPendings[item.no]) {
				continue;
			}
			const itemRtc = this.rtcPendings[item.no]
			if (!itemRtc) {
				// 抢占任务,rtc没抢占,http就抢占了，下面会标记http抢占
				nextItem = item;
				break
			}
			// 此item,rtc已经抢占了，http还未抢占，列为备选，下面会计算将此备选修改为rtc抢占后没有解决的
			if (!nextItem) {
				nextItem = item;
			}
			// 上次列为备选的 nextItem , 本次将要列为备选的 item, 谁的耗时久（时间戳小），谁就作为最终备选
			// 找到最左侧,rtc已开始但是最长时间没完成的那个
			if (this.rtcPendings[item.no] < this.rtcPendings[nextItem.no]) {
				nextItem = item;
			}
		}
		if (nextItem) {
			this.worker.push(this.taskWrap(nextItem, () => {
				this.trigger('http.start', nextItem)
				this.httpPendings[nextItem.no] = Date.now()
			}))
			this.httpPendings[nextItem.no] = 1
			return false;
		}
		// 没有查询到需要执行的任务,比如说最后就查到一条任务,已经在执行了.
		// 或者某个任务卡住很久,当前window下,都是在执行的了,本次就轮询空任务,下次回调时,会检测任务是否已全部完成的.
		this.worker.push(async (): Promise<partResponse> => {
			await sleep(200)
			return { no: -1, data: null, err: null };
		})
	}

	private rtcInit() {
		const rtc = fastload.rtc()
		clearTimeout(this.rtcLoop)
		const query = (parts: Array<number>) => { rtc.query(this.config.meta, parts,) }
		const hasAlivePeer = (stat: any): Boolean => {
			for (let key in stat) {
				if (stat[key] && stat[key].state == 'open') {
					return true
				}
			}
			return false;
		}
		const getRtcTasks = (items: Array<taskItem>): Array<taskItem> => {
			const arr: Array<taskItem> = [];
			for (const item of items) {
				if (this.rtcPendings[item.no]) {
					// rtc 已经在探测了，跳过这个
					continue
				}
				if (!this.httpPendings[item.no]) {
					// http没执行,rtc抢占到此任务
					arr.push(item)
				}
			}
			if (arr.length) {
				return arr
			}
			// 否则都是rtc在探测的了，或http在执行的了
			let nextItem: taskItem;
			for (const item of items) {
				if (this.rtcPendings[item.no]) {
					// rtc 已经在探测了，跳过这个
					continue
				}
				// http已抢占此任务，rtc还没有，列为rtc的备选任务
				if (!nextItem) {
					nextItem = item
				}
				// 寻找一个http还未开始下载的,或http已下载很久没有完成的
				// 上次备选的 nextItem, 本次预计备选的item,谁的时间久，谁成为最终备选；找到最左侧,http已开始,但是没完成的那个
				if (this.httpPendings[item.no] < this.httpPendings[nextItem.no]) {
					nextItem = item;
				}
			}
			if (nextItem) {
				arr.push(nextItem)
			}
			return arr
		}
		const task = () => {
			const items: Array<taskItem> = this.dispatcher.next(this.config.wsize + this.config.thread, this.check)
			const stat = rtc.getStats()
			this.trigger('rtc.stat', stat, rtc.id)
			if (!items.length) {
				// 当前window下都是已有buffer的了，我们空轮询
				this.rtcLoop = setTimeout(task, 2e3)
				return
			}
			if (!hasAlivePeer(stat)) {
				// 没有可用的peer，rtc无法工作,我们也只能空轮询
				this.rtcLoop = setTimeout(task, 2e3)
				return
			}
			const tasks = getRtcTasks(items)
			if (!tasks.length) {
				// 都是已在探测的了
				this.rtcLoop = setTimeout(task, 2e3)
				return
			}
			const t = Date.now()
			const parts: Array<number> = []
			for (const item of tasks) {
				this.trigger('rtc.start', item)
				parts.push(item.no)
				this.rtcPendings[item.no] = t
			}
			query(parts)
			this.rtcLoop = setTimeout(task, 2e3)
		}
		this.rtcLoop = setTimeout(task, 0)
		this.rtcEvcancel = this.rtcEventInit()
	}

	private rtcEventInit(): Function {
		const rtc = fastload.rtc()
		const events: Array<Function> = [];
		const bufferProgress = ({ id, i, n, uid }) => {
			// 传输进行中,此处的id是 meta|part 的形式
			if (!this.bufferCtrl) {
				return
			}
			const [meta, part] = id.split('|')
			if (this.config.meta != meta) {
				// rtc实例是共享的,非本loader的数据忽略
				return;
			}
			this.rtcFound++;
			this.trigger('rtc.progress', { i, n, meta, part, })
		}
		rtc.listen('buffer.recv', bufferProgress)
		events.push(() => {
			rtc.remove('buffer.recv', bufferProgress)
		})
		const data = ({ id, buffer }) => {
			// 此处的ID是rtc中传输的ID，是 meta|part 的形式
			if (!this.bufferCtrl) {
				return
			}
			const [meta, part] = id.split('|')
			if (this.config.meta != meta) {
				return;
			}
			const item: partResponse = {
				no: part,
				data: buffer,
				err: null,
			}
			this.trigger('rtc.done', item)
			if (!this.bufferInuse.has(part)) {
				this.bufferCtrl.push(buffer)
				this.bufferInuse.add(part)
			}
			delete this.httpPendings[part]
			delete this.rtcPendings[part]
		}
		rtc.listen('buffer', data)
		events.push(() => {
			rtc.remove('buffer', data)
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
		if (fastload.rtcInstance) {
			fastload.rtcInstance.clear()
		}
	}

	static rtc(): libwebrtc {
		if (!this.rtcInstance) {
			this.rtcInstance = new libwebrtc(iceServers)
			this.rtcInstance.init()
		}
		return this.rtcInstance
	}
}
