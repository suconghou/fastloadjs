import { ws, uuid, concatArrayBuffers, str2ab, ab2str, padRight, sleep, info } from './util/util'
import event from './util/event'
import manager from './manager'

const s = 51200

export default class extends event {
	private m: manager
	public id: string
	private buffers: Map<string, Array<ArrayBuffer>> = new Map()
	constructor(private readonly servers: RTCConfiguration) {
		super()
		this.m = new manager(servers)
		this.m.listen("message", (e) => {
			const data = e.e.data
			if (data instanceof ArrayBuffer) {
				return this.extract(data, e.uid);
			}
			this.trigger("message", e)
		})
		this.m.listen("open", (e) => this.trigger("open", e))
		this.m.listen("close", (e) => this.trigger("close", e))
		this.m.listen("error", (e) => this.trigger("error", e))
		this.id = uuid()
	}

	private extract(data: ArrayBuffer, uid: string) {
		try {
			const headerLen = 30
			let meta = ab2str(data.slice(0, headerLen)).trim()
			info(meta)
			if (!/^[!-~]+$/.test(meta)) {
				// 不是我们的分片数据直接交由其他程序处理
				this.trigger('message.buffer', { data, uid })
				return
			}
			const buffer = data.slice(headerLen)
			const [id, i, n] = JSON.parse(meta)
			const item = this.buffers.get(id)
			if (item) {
				item[i] = buffer
			} else {
				const b: Array<ArrayBuffer> = []
				b[i] = buffer
				this.buffers.set(id, b)
			}
			// 分片协议前缀 ["id",i,n] ,分片传输中,可用于进度提示
			this.trigger('buffer.recv', {
				id,
				buffer,
				i,
				n,
				uid,
			})
			let done = true;
			const c = this.buffers.get(id)
			for (let j = 0; j < n; j++) {
				if (!c[j]) {
					done = false
				}
			}
			if (!done) {
				return
			}
			let buffers: ArrayBuffer = c[0]
			for (let j = 1; j < n; j++) {
				buffers = concatArrayBuffers(buffers, c[j])
			}
			this.trigger('buffer', {
				id,
				buffer: buffers,
				uid,
			})
			this.buffers.delete(id)
		} catch (e) {
			console.error(e)
		}
	}


	init() {
		ws()
			.listen('offer', (data: any) => {
				this.m.onOffer(data.from, data.data)
			})
			.listen("answer", (data: any) => {
				this.m.onAnswer(data.from, data.data)
			})
			.listen("candidate", (data: any) => {
				this.m.onCandidate(data.from, data.data)
			})
			.listen('online', (data: any) => {
				if (data.id != this.id) {
					this.m.ensureToConnect(data.id)
				}
			})
			.listen('init', (data: any) => {
				this.m.ensureWaitIds(data.ids)
			})
	}

	// 向外暴露API

	// 单个发送
	sendTo(uuid: string, data: any) {
		return this.m.sendTo(uuid, data)
	}

	// 广播
	broadcast(data: any) {
		return this.m.broadcast(data)
	}

	getPeers() {
		return this.m.getPeers();
	}

	getStats() {
		return this.m.getStats()
	}

	async sendBuffer(uuid: string, data: ArrayBuffer, id: string, cancel: Function) {
		const datas = this.splitBuffer(data, id)
		for (let i = 0; i < datas.length; i++) {
			const item = datas[i]
			if (cancel(i, item)) {
				return
			}
			this.sendTo(uuid, item.data)
			await sleep(500)
		}
	}

	broadcastBuffer(data: ArrayBuffer, id: string) {
		const datas = this.splitBuffer(data, id)
		datas.forEach(item => {
			this.broadcast(item.data)
		})
	}

	private splitBuffer(data: ArrayBuffer, id: string) {
		let i = 0;
		let last = false;
		const datas = [];
		const n = Math.ceil(data.byteLength / s)
		while (true) {
			const start = s * i;
			let end = s * (i + 1)
			if (end >= data.byteLength) {
				end = data.byteLength
				last = true
			}
			const v = data.slice(start, end)
			let str = JSON.stringify([
				id.substring(0, 20),
				i,
				n,
			]);
			const t = str2ab(padRight(str, 30));
			datas.push({
				start,
				end,
				i,
				data: concatArrayBuffers(t, v)
			})
			i++
			if (last) {
				return datas;
			}
		}
	}

}


