import { uuid, eqSet, emit, log_log, } from '../../util/util'
import event from '../../util/event'
import { rtcConfig, fragment, objectStrMap, peerStat, resolvingInfo, rtcReqRet, } from '../../types'
import singal, { closeSignal } from './util'
import peer from './peer'
import ws from '../../util/ws';
import { globalBuffer } from '../../util/bufferCenter'

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
	private $ws: ws | null = null;

	// destroy时需清理,否则实例销毁后轮询仍空跑
	private statTimer: any = null;

	// 按 swarmId:sn 记录进行中的p2p请求,多swarm共用此实例
	private resolving: Map<string, resolvingInfo> = new Map();

	// 根据速度等指标，对某些peer禁用一分钟
	private disabledPeers: Map<string, number> = new Map();

	// trigger open/close/error/message
	// message 事件拆解，message.buffer buffer
	constructor(private readonly opts: rtcConfig) {
		super()
		if (opts.tracker && typeof window.RTCPeerConnection == 'function') {
			this.$ws = singal(opts.tracker);
			this.init(this.$ws);
			this.statTimer = setInterval(() => {
				if (!this.enable) {
					return
				}
				const data = this.getStats()
				if (Object.keys(data).length) {
					emit('peers', data)
				}
				const retryMap: Map<string, Array<fragment>> = new Map();
				const now = Date.now();
				for (const [key, item] of this.resolving) {
					const has = globalBuffer.get(item.id, item.sn)
					if (has) {
						this.resolving.delete(key)
						continue
					}
					if (now - item.t >= 60e3) {
						const arr = retryMap.get(item.id)
						if (arr) {
							arr.push({ sn: item.sn })
						} else {
							retryMap.set(item.id, [{ sn: item.sn }])
						}
					}
				}
				for (const [id, parts] of retryMap) {
					this.req(id, parts)
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
	// parts.length 5-15
	req(id: string, parts: Array<fragment>): rtcReqRet {
		if (!this.enable) {
			// P2P功能已禁用
			return { unresolved_retry: [], guessed_retry: [], unresolved: parts, guessed: [], guessed_eachother: [] }
		}
		const bufferedSeconds = this.opts.buffered ? this.opts.buffered() : 0;
		this.join(id);
		const t = Date.now();
		const tMinute = Math.floor(t / 1e3 / 60);
		let last: Array<fragment> = [...parts];
		const s = this.getStats();
		const servers_arr: Array<peerItem> = [];
		const clients_arr: Array<peerItem> = [];
		for (const [uid, peerItem] of Object.entries(s)) {
			// 仅判断RTCDataChannelState的状态是不准确的，还需要判断RTCPeerConnectionState
			if (!(peerItem?.state === 'open' && peerItem?.cstate === 'connected')) {
				continue;
			}
			const p = streams.get(uid)
			if (!p) {
				continue
			}
			const disinfo = this.disabledPeers.get(uid)
			let retry = false;
			if (disinfo) {
				// 有禁用的信息
				if (disinfo === tMinute) {
					// 仍然在禁用的1分钟内
					continue
				}
				// 禁用已过期
				retry = true; // 此节点可以再次探测
				this.disabledPeers.delete(uid)
			}
			// 如果这个是个中继，或者速度很慢，或者丢包严重，并且我们有server peer了，或者有client peer持有现在所需数据，则放弃这个peer
			const pp = peerItem.responseParts / (peerItem.resolveParts || 1); // 回复率
			if ((last.length == 0 || servers_arr.length > 0) && (peerItem.relay || (peerItem.speed > 0 && peerItem.speed < 60) || (pp > 0 && pp < 0.5))) {
				// 如果标记了retry,则表明我们已知道节点慢，已禁用了1分钟，此时需要在给他一次机会，有retry时不能continue
				if (!retry) {
					this.disabledPeers.set(uid, tMinute)
					continue
				}
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
			// 回复率高的在前
			const aa = a.stat.responseParts / (a.stat.resolveParts || 1);
			const bb = b.stat.responseParts / (b.stat.resolveParts || 1);
			const pp = bb - aa;
			if (pp != 0) {
				return pp;
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
		// 如果已缓冲了20s,则又加4s,60则12s
		const wait = 15e3 + Math.random() * 200 * bufferedSeconds;
		for (const task of parts) {
			const taskKey = `${id}:${task.sn}`
			const did = this.resolving.get(taskKey)
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
					let server_found = false, client_found = false;
					for (const x of servers_arr) {
						if (x.peer.id != did.uid) {
							add_task(x.peer, task)
							server_found = true
							break
						}
					}
					if (!server_found && clients_arr.length) {
						const client_max = this.sort_guess_client(task.sn, clients_arr)
						for (const x of client_max) {
							if (x.peer.id !== did.uid) {
								add_task(x.peer, task)
								client_found = true
								break
							}
						}
					}
					if (server_found || client_found) {
						if (client_found) {
							guessed_retry.push(task)
						}
						// else server_found, 无需记录，视为已解决
					} else {
						// retry 时 client 端没有找到,之前的server peer也用过了,如果开启了prefetch,将会向速度排行快的几个peer索要，若没有开启，则rtc无法获取，后续http将获取
						unresolved_retry.push(task)
					}

				} else {
					// 首先检测是否有进度非常接近的的client peer,如果有，则他的优先级高于server peer
					const maybe_client = this.sort_guess_client(task.sn, clients_arr, 10);
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
						// retry 时，只有上次的那个peer持有，没有可用的server peers,没有除那个peer外其他peers持有这个，也猜测不出最佳peer
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
						console.error('not found in all clients_arr', task, clients_arr)
						unresolved.push(task)
					}
				}

			}
		}
		const guessed_sn = guessed.map(item => item.sn)
		const guessed_each: Set<fragment> = new Set();
		for (const [peer, parts] of tasks) {
			// 当我向它索要时，发现它已经向我索要了，后索要者需立即发起http下载,我们存储到guessed_eachother，上层需尽快获取下载
			const gg: Set<fragment> = peer.resolve(id, parts)
			gg.forEach(it => guessed_each.add(it))
			parts.forEach(part => {
				this.resolving.set(`${id}:${part.sn}`, { t, uid: peer.id, guess: guessed_sn.includes(part.sn), id, sn: part.sn, })
			})
		}
		const guessed_eachother = Array.from(guessed_each)
		return { unresolved, guessed, unresolved_retry, guessed_retry, guessed_eachother };
	}

	// 序号<=sn,与sn的差值越小，排名越前，
	// 此前已经判断过blocks中，定没有sn,此算法目的在于猜测出哪个peer最可能将要下载下来，gap指定相差超过这个值则放弃这个peer
	private sort_guess_client(sn: number, clients: Array<peerItem>, gap = 30): Array<peerItem> {
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
				// 说明上个for里,num值已被修改,才有几率可能持有，如果n都是大于sn的，基本后续也不会持有
				n_obj[peer.peer.id] = num;
				c_arr.push(peer)
			}
		}
		return c_arr.sort((a, b) => n_obj[a.peer.id] - n_obj[b.peer.id])
	}

	private init(ws: ws) {
		ws.listen('offer', (data: any) => this.onOffer(data.from, data.data))
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
					ws.sendJson({ event: 'join', ids: [...this.hostIds] })
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
		if (!eqSet(this.hostIds, this.wsIds) && this.$ws) {
			this.$ws.sendJson({ event: 'join', ids: [...this.hostIds] })
			this.wsIds = new Set(this.hostIds)
		}
	}

	getPeers() {
		return streams.keys()
	}

	// 本端uid
	get id(): string {
		return this.me
	}

	getStats(): objectStrMap<peerStat> {
		const now = Date.now();
		const stat: objectStrMap<peerStat> = {};
		const ttl = streams.size > 60 ? 30e3 : 60e3; // 浏览器限制RTCPeerConnection最多大概允许300+，Failed to construct 'RTCPeerConnection': Cannot create so many PeerConnections
		streams.forEach(item => {
			const s = item.stat()
			const old = (now - s.createtime > ttl) && (now - (s.activetime || s.createtime) > ttl) && ((s.state && s.state !== 'open') || (s.cstate && s.cstate !== 'connected'));
			const pp = s.responseParts / (s.resolveParts || 1); // 回复率
			const bad = (s.speed <= 0 && s.packet > 5) || (s.speed > 0 && s.speed < 60) || (pp > 0 && pp < 0.5);
			if (old || (streams.size > 60 && bad) || (streams.size > 100 && s.relay)) {
				item.destroy();
				streams.delete(item.id)
			} else {
				stat[item.id] = s
			}
		})
		return stat;
	}

	// 彻底销毁:停止轮询,销毁所有peer,关闭信令连接
	destroy() {
		this.enable = false
		clearInterval(this.statTimer)
		this.statTimer = null
		this.$ws = null
		closeSignal()
		streams.forEach(item => item.destroy())
		streams.clear()
		this.resolving.clear()
		this.disabledPeers.clear()
	}

	// 如果没有则新建
	private getPeer(uid: string): peer {
		let s = streams.get(uid);
		if (!s) {
			s = new peer(uid, this.opts, (type: string, data: Object) => this.trigger(type, data));
			streams.set(uid, s)
		}
		return s
	}

	// 我ws上线后，收到有有这么多用户已在线，他们若是收到我的online消息会主动connect我
	private waitIds(ids: Set<string>) {
		log_log("peers", ids)
	}

	// 这个id online了，我们需要主动链接他
	private toConnect(id: string) {
		// 如果对方是断线重连,无论之前是他早于我上线(他链接的我),还是我早于他上线(我链接的他)
		// 再次上线后,都变成我主动链接他
		this.getPeer(id).checkConn()
	}

	// 我方上线消息被对方察觉,然后主动链接我方,向我发来了offer，此时getPeer可能是新建了属于正常
	// 我方应 setRemoteDescription,createAnswer,setLocalDescription,ws.send
	private async onOffer(from: string, sdp: RTCSessionDescription) {
		this.getPeer(from).onOffer(sdp)
	}

	// 我发送的offer对方给了回应,我马上就可以链接他了
	// 此时getPeer必选不能是新创建了一个，而是之前已创建了并且向对方发送了offer的（设置过setLocalDescription）
	private async onAnswer(from: string, sdp: RTCSessionDescription) {
		this.getPeer(from).onAnswer(sdp)
	}

	// 无论是我方主动connect，还是收到offer,回复answer,后续都是双方交换candidate
	// 此时的getPeer必然不能是新创建了一个，而是发送过offer,或者收到过offer的那个
	private async onCandidate(from: string, candidate: RTCIceCandidate) {
		this.getPeer(from).onCandidate(candidate)
	}



}


