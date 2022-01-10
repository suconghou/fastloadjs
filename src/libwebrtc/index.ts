import bufferCenter, { globalBuffer } from "../lib/utils/bufferCenter";
import libwebrtc from "./rtc";
import { warn, info } from './util/util'

/**
 * query 全网查询, {id,index, }
 * found 响应我持有资源
 * resolve 请求下载资源
 */

export default class extends libwebrtc {

	private globalBuffer: bufferCenter = globalBuffer;

	// 在query后,记录一个资源有哪些用户回复了found,当一个资源已决定resolve后,迟到的found将被丢弃(is already resolved)
	private founders: Map<string, Array<string>> = new Map()
	private founderTimers = {}

	// 记录都有哪些用户query过一个资源,当我们已持有时,回复给他们found消息
	private queries: Map<string, Array<string>> = new Map()

	// 由于rtc的实例对于上层是共享的,这里记录一个资源,如果我们已持有,如何获取它,上层在主动query一个资源时初始化
	private resolver: Map<string, Function> = new Map()

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

	// 传入的resolve代表此数据块可用时,可用此resolve函数取到
	query(id: string, index: number, resolve: Function) {
		this.founders.set(`${id}:${index}`, [])
		this.resolver.set(id, resolve)
		this.broadcast(JSON.stringify({
			event: 'query',
			data: {
				id,
				index
			}
		}))
	}

	// 1.无论是http下载获取到此数据块,
	// 2.还是有peer发送给我们这个数据块了
	// 3.有peer查询此数据块了,
	// > 1. 都会调用这个函数,1,2两种情况resolve必然能取到数据,发送给查询过此数据块的用户found回应,同时给我们查询过的哪些peer发送quit
	// > 2. 如果有用户查询时,我们也调用此函数检查,当我们持有数据块时,回应found
	async found(id: string, index: number) {
		const resolve = this.resolver.get(id)
		if (!resolve) {
			// 用户查询的这个资源我们从来没接触过,更别提里面的数据块了.
			warn("no resolve found for ", id)
			return
		}
		const k = `${id}:${index}`
		const buffer: ArrayBuffer = await resolve(id, index)
		if (!buffer) {
			warn("resolve has no buffer for ", id, index)
			return
		}
		this.refBuffers.set(k, buffer)
		// 如果此数据块我们持有,1. 给那些查询过的用户响应found 2. 给那些我们查询且resolve的用户发送quit
		const u = this.queries.get(k)
		if (u && u.length) {
			// 若不符合此条件,则代表没有人查询过,或者都已回复过
			u.forEach(uid => {
				this.sendTo(uid, JSON.stringify({
					event: 'found',
					data: {
						id,
						index,
					}
				}))
			})
		}
		this.queries.delete(k)
		// 检查此资源我们是否向其他peer索要过,如果索要过,现在我们已经持有了,就别让对方发送了
		const r = this.waitres.get(k)
		if (r) {
			this.quit(r, id, index)
		}
		this.waitres.delete(k)

	}

	// 如果播放器已销毁,或跳转到其他页面,我们应广播我们之前所有的查询和resolve都作废
	clear() {
		this.broadcast(JSON.stringify({
			event: 'quit',
			data: {
				id: '',
				index: 0
			}
		}))
	}

	private quit(uid: string, id: string, index: number) {
		this.sendTo(uid, JSON.stringify({
			event: 'quit',
			data: {
				id,
				index,
			}
		}))
	}

	private listenInit() {
		const quitList = {}
		const quitUids = {}
		this.listen('ping', ({ uid }) => {
			info("got ping from ", uid)
			this.sendTo(uid, JSON.stringify({ event: 'pong' }))
		})
		this.listen('pong', ({ uid }) => {
			info("got pong from ", uid)
		})
		this.listen("quit", async ({ data, uid }) => {
			// 如果对方发来的id为空,index为0,即代表对方peer放弃之前全部操作
			const { id, index } = data
			if (index == 0 && id == "") {
				quitUids[uid] = +new Date()
			} else {
				quitList[`${id}|${index}`] = {
					time: +new Date(),
					uid,
				}
			}
			// info('got quit msg ', quitList, data, uid)
		})
		this.listen('query', async ({ data, uid }) => {
			const { id, index } = data
			const k = `${id}:${index}`
			const u = this.queries.get(k)
			if (!u) {
				this.queries.set(k, [uid])
			} else {
				u.push(uid)
			}
			await this.found(id, index)
		})
		this.listen('found', ({ data, uid }) => {
			// 多个客户响应了,选取前几个客户随机发送请求
			const { id, index } = data
			const k = `${id}:${index}`
			let u = this.founders.get(k)
			// 这些uid返回了他们持有这个资源
			// info(uid, " has ", k)
			if (!u) {
				return warn(k + " is already resolved")
			}
			u.push(uid)
			clearTimeout(this.founderTimers[k])
			this.founderTimers[k] = setTimeout(async () => {
				// 如果对方响应found很慢,我们已经持有了此资源,则忽略
				const resolve = this.resolver.get(id)
				if (resolve) {
					const has = await resolve(id, index)
					if (has) {
						return
					}
				}
				const rr = u[Math.floor(Math.random() * u.length)]
				this.sendTo(rr, JSON.stringify({
					event: 'resolve',
					data: {
						id,
						index,
					}
				}))
				// 同时,记录我们这个资源是向哪个peer索要的,当我们已持有时,在found里,对此peer发送quit
				this.waitres.set(k, rr);
				this.founders.delete(k)
			}, 100)
		})
		this.listen('resolve', async ({ data, uid }) => {
			delete quitUids[uid]
			const { id, index } = data
			const buffer = this.refBuffers.get(`${id}:${index}`)
			if (buffer) {
				const bufferKey = `${id}|${index}`
				// 当我们收到quit时,使用此键存储收到哪个用户的quit,在队列发送时,如果检测到此数据块已quit,
				// 并且是我们要发送的那个用户发来的,并且是60s内发来的,则说明对方已不需要此数据块
				return await this.sendBuffer(uid, buffer, bufferKey, () => {
					if (quitUids[uid]) {
						// 如果这个peer发送了quit作废之前所有操作,则不要发送数据给他,直到下次这个用户又向我resolve了
						return true
					}
					const has = quitList[bufferKey]
					if (has && uid == has.uid && +new Date() - has.time < 60e3) {
						// log("so stop send to ", uid, bufferKey)
						has.time = 0
						return true
					}
				})
			}
			return console.error("unresolved", id, index)
		})
		this.listen('buffer.recv', async (res) => {
			this.trigger('buffer.progress', res)
			// 当resolve时,http还未下载或未下载完成,但是收到rtc分片时,http已完成,则取消剩余分片
			// 此处是一个冗余检查,我们在http已持有时foud调用里,也会检查发送quit
			const [id, index] = res.id.split('|')
			// id 为资源 vid:itag , index 为range分片ID
			const resolve = this.resolver.get(id)
			if (resolve) {
				const has = await resolve(id, index)
				if (has) {
					// log("send quit buffer recv msg", res)
					this.quit(res.uid, id, index)
				}
			}
		})
		// 这个资源全部分片已取到,我们清除我们已索要的记录,防止found函数里又发送了quit(因为通过http和rtc获取到数据块都会走found,我们希望发送quit是仅在http持有后发送给rtc取消指令)
		this.listen('buffer', ({ id, uid, buffer }) => {
			let [idtag, index] = id.split('|')
			this.waitres.delete(idtag)
			index = Number(index)
			this.trigger('data', {
				id: idtag,
				index,
				buffer,
			})
		})

	}

}
