import { uuid, eqSet, emit, } from '../../util/util'
import event from '../../util/event'
import { config, fragment, objectStrMap, peerStat, resolvingInfo, rtcReqRet, } from '../../types'
import singal from './util'
import peer from './peer'
import ws from '../../util/ws';

interface peerItem {
	readonly stat: peerStat
	readonly peer: peer,
	readonly blocks: Array<number>
}



const streams = new Map<string, peer>()

export default class extends event {

	private enable = false;

	// 记录与我们播放和持有的相关资源
	private hostIds: Set<string> = new Set()
	// 当前ws链接已经持有的IDS
	private wsIds: Set<string> = new Set()

	private me: string = uuid()
	private $ws: ws;

	private resolving: Map<number, resolvingInfo> = new Map();

	// trigger open/close/error/message
	// message 事件拆解，message.buffer buffer
	constructor(private readonly opts: config) {
		super()
		if (opts.tracker && typeof window.RTCPeerConnection == 'function') {
			this.$ws = singal(opts.tracker);
			this.init();
			setInterval(() => {
				const data = this.getStats()
				if (Object.keys(data).length) {
					emit('peers', data)
				}
			}, 2e3)
			this.enable = true
		}
	}

	// 根据对端图解，猜测要向哪个peer获取，可以分解任务，并发向多个peer索取
	// 1. 先判断对端是否在线,找到server peers，和client peers持有当前parts中部分的
	// 2. 我们请求的和当前两个分析出的分组对比，都没持有的向server peers发送请求
	// 3. 对client peers持有我们请求的，将我们请求均匀分布下去
	// 4. 重试时，15s内的不重复发送，除非上次是guess,本次直接找到了
	// 5. 重试时，排除上次发送的那个peer,在剩余的找也持有我们需要的
	// 6. 如果找不到，还是按照server peers,然后猜测最佳client peers算法
	// cachedNum 是往后50分片中，有多少分片已经持有了，如果分片多，则retry可以多等待一会
	req(id: string, parts: Array<fragment>, cachedNum: number): rtcReqRet {
		if (!this.enable) {
			// P2P功能已禁用
			return { unresolved_retry: [], guessed_retry: [], unresolved: parts, guessed: [] }
		}
		this.join(id);
		const t = Date.now();
		let last: Array<fragment> = [...parts];
		const s = this.getStats();
		const servers_arr: Array<peerItem> = [];
		const clients_arr: Array<peerItem> = [];
		for (const [uid, peerItem] of Object.entries(s)) {
			if (peerItem.state !== 'open') {
				continue
			}
			const p = streams.get(uid)
			if (!p) {
				continue
			}
			if (peerItem.speed <= 0 && peerItem.packet > 5) {
				// 接收了很多数据了，但是没有计算出速度，可能丢包严重，排除掉这个peer,无论是client还是server
				continue
			}
			// 如果这个是个中继，或者速度很慢，或者丢包严重，并且我们有server peer了，或者有client peer持有现在所需数据，则放弃这个peer
			if ((last.length == 0 || servers_arr.length > 0) && (peerItem.relay || (peerItem.speed > 0 && peerItem.speed < 100) || peerItem.packet > 3)) {
				continue
			}
			if (peerItem.isServer) {
				servers_arr.push({ peer: p, stat: peerItem, blocks: [] })
				continue
			}
			const hosts = peerItem.hosts[id]
			if (!hosts || hosts.length < 1) {
				// 这个client peer 完全没有当前资源的信息
				continue
			}
			// 这个peer可能有我们需要的若干部分
			clients_arr.push({ peer: p, stat: peerItem, blocks: hosts })
			last = last.filter(item => !hosts.includes(item.sn))
		}

		const fn_sort = (a: peerItem, b: peerItem): number => {
			// 判断速度，速度快的在前，
			const x = b.stat.speed - a.stat.speed
			if (x != 0) {
				return x
			}
			const p = a.stat.packet - b.stat.packet
			if (p != 0) {
				return p
			}
			// 速度，丢包，均判断不出来，则非中继的优先
			if (a.stat.relay !== b.stat.relay) {
				return a.stat.relay ? 1 : -1;
			}
			// 最后，流量少的排在前
			return a.stat.rx - b.stat.rx
		}

		clients_arr.sort(fn_sort);
		servers_arr.sort(fn_sort);

		const tasks: Map<peer, Set<fragment>> = new Map();
		const unresolved: Array<fragment> = [];
		const guessed: Array<fragment> = [];
		const unresolved_retry: Array<fragment> = [];
		const guessed_retry: Array<fragment> = [];
		let i = 0, j = 0;
		const add_task = (peer: peer, task: fragment) => {
			const tt = tasks.get(peer)
			if (tt) {
				tt.add(task)
			} else {
				tasks.set(peer, new Set([task]))
			}
		}
		// 多10个分片，就多等10秒
		const wait = 15e3 + cachedNum * 1000;
		for (const task of parts) {
			const did = this.resolving.get(task.sn)
			const inLast = last.find(it => it.sn == task.sn)
			const retry = did && t - did.t > wait; // 距离上次已过15s
			if (did && t - did.t < wait) {
				// 距离上次不到15s,但是上次是guess,本次不是，则可以重发
				const wefound = did.guess && !inLast;
				if (!wefound) {
					continue
				}
			}
			if (inLast) {
				// 这一块数据，所有client peers都没有
				if (retry) {
					let found = false;
					for (const x of servers_arr) {
						if (x.peer.id != did.uid) {
							add_task(x.peer, task)
							found = true
							break
						}
					}
					if (!found && clients_arr.length) {
						const client_max = this.sort_guess_client(task.sn, clients_arr)
						for (const x of client_max) {
							if (x.peer.id !== did.uid) {
								add_task(x.peer, task)
								found = true
								break
							}
						}
					}
					if (found) {
						guessed_retry.push(task)
					} else {
						unresolved_retry.push(task)
					}

				} else {
					// 首先检测是否有进度非常接近的的client peer,如果有，则他的优先级高于server peer
					const maybe_client = this.sort_guess_client(task.sn, clients_arr, 6);
					if (maybe_client.length) {
						const c = maybe_client[0]
						add_task(c.peer, task)
						guessed.push(task)
					} else if (servers_arr.length) {
						if (i >= servers_arr.length) {
							i = 0;
						}
						const server = servers_arr[i];
						add_task(server.peer, task)
						i++
					} else if (clients_arr.length) {
						// 根据序号相近排序
						const client_max = this.sort_guess_client(task.sn, clients_arr)
						if (client_max.length) {
							const c = client_max[0]
							add_task(c.peer, task)
							guessed.push(task)
						} else {
							unresolved.push(task)
						}
					} else {
						unresolved.push(task)
					}

				}

			} else {
				// 这个数据块必然能够在clients_arr中找到
				if (retry) {
					// retry 时，可能那个数据块只在前一轮分析的那个peer中持有，如果我们找不到，就依次按照server peers 和 client_max 中查找
					let found = false;
					for (const x of clients_arr) {
						const have = x.blocks.find(it => it == task.sn)
						if (have && x.peer.id != did.uid) {
							add_task(x.peer, task)
							found = true
							break
						}
					}
					if (!found && servers_arr.length) {
						// 没发现就尝试servers
						for (const x of servers_arr) {
							if (x.peer.id != did.uid) {
								add_task(x.peer, task)
								found = true
								break
							}
						}
					}
					if (!found && clients_arr.length) {
						const client_max = this.sort_guess_client(task.sn, clients_arr)
						for (const x of client_max) {
							if (x.peer.id !== did.uid) {
								add_task(x.peer, task)
								guessed_retry.push(task)
								found = true
								break
							}
						}
					}
					if (!found) {
						// retry 时，只有上次的那个peer持有，没有可用的server peers,没有除那个peer外，其他peers持有这个，也猜测不出最佳peer
						unresolved_retry.push(task)
					}

				} else {
					if (j >= clients_arr.length) {
						j = 0;
					}
					let found = false
					for (; j < clients_arr.length; j++) {
						const client = clients_arr[j];
						const have = client.blocks.find(it => it == task.sn)
						if (have) {
							add_task(client.peer, task)
							found = true
							j++
							break
						}
					}
					if (!found) {
						// 再试一遍
						for (j = 0; j < clients_arr.length; j++) {
							const client = clients_arr[j];
							const have = client.blocks.find(it => it == task.sn)
							if (have) {
								add_task(client.peer, task)
								found = true
								j++
								break
							}
						}
					}
					if (!found) {
						// 这是不可能的
						console.error('error found')
						unresolved.push(task)
					}
				}

			}
		}
		const guessed_sn = guessed.map(item => item.sn)
		for (const [peer, parts] of tasks) {
			peer.resolve(id, parts)
			parts.forEach(part => {
				this.resolving.set(part.sn, { t, uid: peer.id, guess: guessed_sn.includes(part.sn) })
			})
		}
		return { unresolved, guessed, unresolved_retry, guessed_retry } as rtcReqRet;
	}

	// 序号<=sn,与sn的差值越小，排名越前，
	private sort_guess_client(sn: number, clients: Array<peerItem>, gap = 1e9): Array<peerItem> {
		const c_arr: Array<peerItem> = [];
		const n_obj: objectStrMap<number> = {};
		for (const peer of clients) {
			let num = gap;
			for (const n of peer.blocks) {
				const d = sn - n;
				if (d >= 0 && d < num) {
					num = d;
				}
			}
			if (num < gap) {
				// 才有几率可能持有，如果n都是大于sn的，基本后续也不会持有
				n_obj[peer.peer.id] = num;
				c_arr.push(peer)
			}
		}
		return c_arr.sort((a, b) => n_obj[a.peer.id] - n_obj[b.peer.id])
	}

	private init() {
		this.$ws
			.listen('offer', (data: any) => this.onOffer(data.from, data.data))
			.listen("answer", (data: any) => this.onAnswer(data.from, data.data))
			.listen("candidate", (data: any) => this.onCandidate(data.from, data.data))
			.listen('online', (data: any) => {
				if (data.id != this.me) {
					this.toConnect(data.id)
				}
			})
			.listen('init', (data: any) => this.waitIds(new Set(data.ids)))
			.listen('open', () => {
				if (this.hostIds.size && !eqSet(this.hostIds, this.wsIds)) {
					// 无论是断线重连还是首次，都可以发送
					this.$ws.sendJson({ event: 'join', ids: [...this.hostIds] })
					this.wsIds = new Set(this.hostIds)
				}
			}).listen('close', () => {
				this.wsIds = new Set()
			}).listen('error', () => {
				this.wsIds = new Set()
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
		const now = Date.now();
		const stat: objectStrMap<peerStat> = {};
		streams.forEach(item => {
			const s = item.stat()
			if (s.activetime && now - s.activetime > 3600e3 && s.state !== 'open') {
				item.destroy();
				streams.delete(item.id)
			} else {
				stat[item.id] = s
			}
		})
		return stat;
	}

	private newPeer(uid: string, passive: boolean) {
		const s = new peer(uid, this.opts, (type: string, data: Object) => this.trigger(type, data));
		streams.set(uid, s)
		passive ? s.waitForConnect() : s.checkConn()
	}

	private waitIds(ids: Set<string>) {
		ids.forEach(id => {
			if (id == this.me) {
				return
			}
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
			s.checkConn()
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


