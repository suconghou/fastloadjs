import { globalBuffer } from "../lib/utils/bufferCenter";
import libwebrtc from "./rtc";
import { warn, info } from './util/util'

/**
 * query 全网查询, {id,parts, }
 * found 响应我持有资源
 * resolve 请求下载资源
 */

export default class extends libwebrtc {

	// 在query后,记录一个资源有哪些用户回复了found,当一个资源已决定resolve后,迟到的found将被丢弃(is already resolved)
	private founders: Map<string, Array<string>> = new Map()
	private founderTimers = {}

	// 记录都有哪些用户query过一个资源,当我们已持有时,回复给他们found消息
	private queries: Map<string, Array<string>> = new Map()

	// 记录我们一个资源都向哪些peer索要的
	private waitres: Map<string, string> = new Map()

	constructor(servers: RTCConfiguration) {
		super(servers)
		this.listen('message', (e) => {
			const uid = e.uid;
			const text = e.e.data;
			try {
				const { event, data } = JSON.parse(text)
				this.trigger(event, { data, uid })
			} catch (e) {
				console.error(e)
			}
		})
		this.listenInit()
	}

	// 查询时，我们新建一个数组，存储有哪些uid,答复了found,供后续resolve时挑选一个uid
	query(id: string, parts: Array<number>) {
		parts.forEach(part => {
			this.founders.set(`${id}|${part}`, [])
		})
		this.broadcast(JSON.stringify({
			event: 'query',
			data: {
				id,
				parts,
			}
		}))
	}

	// 我们持有了此buffer,(http下载或者rtc下载)，都会在此声明
	// 对于我们向别人query过，我们需要发送quit,
	// 对于别人向我们query过，我们回复found
	found(id: string, part: number) {
		// 我们收到别的的query存储到了queries
		// 此数据块我们现在持有了,1. 给那些查询过的用户响应found 2. 给那些我们查询的用户发送quit
		const k = `${id}|${part}`
		const u = this.queries.get(k)
		if (u && u.length) {
			// 若不符合此条件,则代表没有人查询过,或者都已回复过
			u.forEach(uid => {
				this.sendTo(uid, JSON.stringify({
					event: 'found',
					data: {
						id,
						parts: [part],
					}
				}))
			})
		}
		this.queries.delete(k)
		// 我们是否向其他人query过，我们自己向外的query存储在 founders
		// 我们query时新建的这个可以不要了，因为我们不需要别人回复found了
		this.founders.delete(k)
		// 检查此资源我们是否向其他peer索要过,我们的query收到回复found后，我们的resolve请求存储在waitres里
		// 如果索要过(resolve),现在我们已经持有了,就终止对方发送(如果对方是队列发送可以取消点，已在发送中取消不掉)
		const r = this.waitres.get(k)
		if (r) {
			this.quit(r, id, part)
		}
		this.waitres.delete(k)
	}

	// 如果播放器已销毁,或跳转到其他页面,我们应广播我们之前所有的查询和resolve都作废
	clear() {
		this.broadcast(JSON.stringify({
			event: 'quit',
			data: {
				id: '',
				part: 0,
			}
		}))
	}

	private quit(uid: string, id: string, part: number) {
		this.sendTo(uid, JSON.stringify({
			event: 'quit',
			data: {
				id,
				part,
			}
		}))
	}

	private listenInit() {
		this.listen('ping', ({ uid }) => {
			info("got ping from ", uid)
			this.sendTo(uid, JSON.stringify({ event: 'pong' }))
		})
		this.listen('pong', ({ uid }) => {
			info("got pong from ", uid)
		})
		this.listen("quit", async ({ data, uid }) => {
			// 如果对方发来的id为空,part为0,即代表对方peer放弃之前全部操作
			const { id, part } = data
			console.info('quit', data, uid)
			const k = `${id}|${part}`
			// 之前对方发送来的query记录，我们清除掉，在我们持有数据后，就不会给他发送了
			let u = this.queries.get(k)
			if (u && u.length) {
				u = u.filter(i => i != uid)
			}
			if (!u || !u.length) {
				this.queries.delete(k)
			} else {
				this.queries.set(k, u)
			}
		})
		this.listen('query', ({ data, uid }) => {
			// reply found if we have this buffer, else remember it , once we have this buffer , also send to him (if he not sent quit during this time)
			const { id, parts } = data
			const founds = [];
			const remember = [];
			for (const part of parts) {
				if (globalBuffer.get(id, part)) {
					founds.push(part)
				} else {
					remember.push(part)
				}
			}
			if (founds.length) {
				this.sendTo(uid, JSON.stringify({
					event: 'found',
					data: {
						id,
						parts: founds,
					}
				}))
			}
			// else remember it, once we have this buffer , will send to him,
			for (const part of remember) {
				const k = `${id}|${part}`
				const u = this.queries.get(k)
				if (!u) {
					this.queries.set(k, [uid])
				} else {
					if (!u.includes(uid)) {
						u.push(uid)
					}
				}
			}
		})
		this.listen('found', ({ data, uid }) => {
			// 多个客户响应了,选取前几个客户随机发送请求
			const { id, parts } = data
			for (const part of parts) {
				const k = `${id}|${part}`
				let u = this.founders.get(k)
				// 这些uid返回了他们持有这个资源,如果founders没有，代表我们已经发送resolve请求了，正在等待响应/或者我们已经有了，我们主动清理了found
				if (!u) {
					continue
				}
				if (!u.includes(uid)) {
					u.push(uid)
				}
				clearTimeout(this.founderTimers[k])
				this.founderTimers[k] = setTimeout(async () => {
					// 如果对方响应found很慢,我们已经持有了此资源,则忽略
					const has = globalBuffer.get(id, part)
					if (has) {
						console.info('rtc slow, we already have')
						return
					}
					const rr = u[Math.floor(Math.random() * u.length)]
					this.sendTo(rr, JSON.stringify({
						event: 'resolve',
						data: {
							id,
							part,
						}
					}))
					// TODO can improve retry another
					// 同时,记录我们这个资源是向哪个peer索要的,当我们已持有时,在found里,对此peer发送quit
					this.waitres.set(k, rr);
					this.founders.delete(k)
					delete this.founderTimers[k]
				}, 100)
			}
		})
		this.listen('resolve', async ({ data, uid }) => {
			const { id, part } = data
			const buf = globalBuffer.get(id, part)
			if (!buf) {
				return console.error("unresolved", id, part)
			}
			const bufferKey = `${id}|${part}`
			console.info('sendto ', uid, id, part)
			return this.sendBuffer(uid, buf.buffer, bufferKey)
		})
		// 上层可以监听 buffer.recv 处理分片的进度
		// 上层监听buffer,处理资源完整分片收到后的操作

		// 这个资源全部分片已取到,我们清除我们已索要的记录,query时的founders，resolve时的waitres
		// 这样后续上层found时，我们不用再次发送quit了，(因为通过http和rtc获取到数据块都会走found,我们希望发送quit是仅在http持有后发送给rtc取消指令)
		this.listen('buffer', ({ id, uid, buffer }) => {
			this.founders.delete(id)
			this.waitres.delete(id)
			const [meta, part] = id.split('|')
			this.found(meta, part)
		})

	}

}
