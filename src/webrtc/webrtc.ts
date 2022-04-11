import { singal, uuid } from './util/util'
import event from './util/event'
import peer from './peer'
import { fastConfig, objectStrMap, peerStat } from '../lib/types'
import ws from './util/ws'
import { eqSet } from '../lib/utils/util'

const streams = new Map<string, peer>()


export default class extends event {

	// 记录与我们播放和持有的相关资源
	private hostIds: Set<string> = new Set()

	// 当前ws链接已经持有的IDS
	private wsIds: Set<string> = new Set()

	private me: string = uuid()
	private $ws: ws;
	// will trigger open/close/error/message
	// message 事件拆解 message.buffer buffer
	constructor(private readonly opts: fastConfig) {
		super()
		this.$ws = singal(opts.tracker);
		this.init();
	}


	// TODO 根据对端图解，猜测要向哪个peer获取，可以分解任务，并发向多个peer索取
	// 1. 先判断对端是否在线
	// 2. 优先查找非server类型，且持有当前parts中部分的
	// 3. 直到当前parts中消耗完毕，若仍有则向server peer发起请求
	// 4. 如果没有server peer,则猜测一个最佳peer发送请求
	// 5. 发送请求后每隔一段时间，检测是否有回复，若没有回复，则换一个peer发送
	// 6. 需要记住哪些刚刚发送过请求，当上层重试时，重试其他的peer
	req(id: string, parts: Array<any>) {
		this.join(id);
		const s = this.getStats();
		for (const [uid, peerItem] of Object.entries(s)) {
			if (peerItem.state !== 'open') {
				continue
			}
			if (peerItem.isServer) {
				// TODO add servers
				continue
			}
			const hosts = peerItem.hosts[id]
			if (!hosts) {
				// 这个client peer 完全没有当前资源的信息
				continue
			}
			// TODO 检查哪些对方持有，我们去索要
			const data = JSON.stringify({ event: 'resolve', data: { id, parts: [1, 2, 3, 4, 5, 6] } })
		}
	}

	private init() {
		this.$ws
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
				if (data.id != this.me) {
					this.toConnect(data.id)
				}
			})
			.listen('init', (data: any) => {
				this.waitIds(data.ids)
			})
	}

	// 如果没有发送过join,则发送join swarm消息
	private join(id: string) {
		this.hostIds.add(id)
		if (!eqSet(this.hostIds, this.wsIds)) {
			this.$ws.sendJson({ event: 'join', ids: [...this.hostIds] })
			this.wsIds = new Set(this.hostIds)
		}
	}

	getPeers() {
		return streams.keys()
	}

	getStats(): objectStrMap<peerStat> {
		const stat: objectStrMap<peerStat> = {};
		streams.forEach(item => {
			stat[item.id] = item.stat()
		})
		return stat;
	}

	private newPeer(uid: string, passive: boolean) {
		const s = new peer(uid, this.opts, (type: string, data: Object) => this.trigger(type, data));
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


