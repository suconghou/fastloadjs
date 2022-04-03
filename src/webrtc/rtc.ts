import { ws, uuid, concatArrayBuffers, str2ab, ab2str, padRight, sleep, info, encode } from './util/util'
import event from './util/event'
import peer from './peer'
import { bufferItem } from '../lib/types'

const streams = new Map<string, peer>()

const rtcMax = 64 * 1024


export default class extends event {
	public id: string
	// will trigger open/close/error/message
	// message 事件拆解 message.buffer buffer
	constructor(private servers: RTCConfiguration) {
		super()
		this.id = uuid()
	}


	init() {
		ws()
			.listen('offer', (data: any) => {
				this.onOffer(data.from, data.data)
			})
			.listen("answer", (data: any) => {
				this.onAnswer(data.from, data.data)
			})
			.listen("candidate", (data: any) => {
				this.onCandidate(data.from, data.data)
			})
			.listen('online', (data: any) => {
				if (data.id != this.id) {
					this.toConnect(data.id)
				}
			})
			.listen('init', (data: any) => {
				this.waitIds(data.ids)
			})
	}

	// 向外暴露API

	// 单个发送
	sendTo(uuid: string, data: any) {
		const s = streams.get(uuid)
		if (!s) {
			return console.error("uuid " + uuid + " not connected")
		}
		return s.send(data)
	}

	// 广播
	broadcast(data: any) {
		streams.forEach(item => {
			item.send(data)
		})
	}

	getPeers() {
		return streams.keys()
	}

	getStats() {
		const stat = {};
		streams.forEach(item => {
			stat[item.id] = item.stat()
		})
		return stat;
	}

	sendBuffer(uuid: string, data: bufferItem) {
		const s = streams.get(uuid)
		if (!s) {
			return console.error("uuid " + uuid + " not connected")
		}
		const datas = this.splitBuffer(data)
		for (let i = 0; i < datas.length; i++) {
			const item = datas[i]
			s.send(item)
		}
	}

	private splitBuffer(data: bufferItem): Array<ArrayBuffer> {
		let i = 0;
		let last = false;
		const l = data.buffer.byteLength
		const datas: Array<ArrayBuffer> = [];
		const n = Math.ceil(l / rtcMax)
		while (true) {
			const start = rtcMax * i;
			let end = rtcMax * (i + 1)
			if (end >= l) {
				end = l
				last = true
			}
			const v = data.buffer.slice(start, end)
			datas.push(encode(v, data.id, data.part, i, n))
			i++
			if (last) {
				return datas;
			}
		}
	}

	private newPeer(uid: string, passive: boolean) {
		const s = new peer(uid, this.servers, (type: string, data: Object) => this.trigger(type, data));
		streams.set(uid, s)
		passive ? s.waitForConnect() : s.connect()
	}

	private waitIds(ids: Array<string>) {
		ids.forEach(id => {
			if (streams.has(id)) {
				// 是我断线重连,无论这些ID中,之前有我主动链接他的,也有他主动链接我的
				// 我重新上线后,都变成他们主动链接我
				const s = streams.get(id)
				s.waitForConnect()
			} else {
				// 是我首次上线,我需要等待这些id链接我
				this.newPeer(id, true);
			}
		})
	}

	private toConnect(id: string) {
		if (streams.has(id)) {
			// 如果对方是断线重连,无论之前是他早于我上线(他链接的我),还是我早于他上线(我链接的他)
			// 再次上线后,都变成我主动链接他
			const s = streams.get(id)
			s.connect()
		} else {
			// 如果对方是首次上线,我方应该主动
			this.newPeer(id, false)
		}
	}

	// 我方上线消息被对方察觉,然后主动链接我方,向我发来了offer
	// 我方应 setRemoteDescription,createAnswer,setLocalDescription,ws.send
	private async onOffer(from: string, sdp: RTCSessionDescription) {
		const s = streams.get(from)
		if (!s) {
			console.error("onOffer peer not found error")
			return
		}
		s.onOffer(sdp)
	}

	// 我发送的offer对方给了回应,我马上就可以链接他了
	private async onAnswer(from: string, sdp: RTCSessionDescription) {
		const s = streams.get(from)
		if (!s) {
			console.error("onAnswer peer not found error")
			return
		}
		s.onAnswer(sdp)
	}

	private async onCandidate(from: string, candidate: RTCIceCandidate) {
		const s = streams.get(from)
		if (!s) {
			console.error("onCandidate peer not found error")
			return
		}
		s.onCandidate(candidate)
	}

}


