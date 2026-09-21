import { concatArrayBuffers, log_log, log_info, uuid, log_warn, sleep, emit } from '../../util/util'
import singal, { candidateInfo, decode, encode, isServer } from './util'
import { globalBuffer } from "../../util/bufferCenter";
import { bufferItem, rtcConfig, fragment, hostsMap, peerStat, resolveTask, rtcBufferItem, rtcProgressInfo, rtcRecv, rtcParts } from '../../types';
import ws from '../../util/ws';

const rtcMax = 60 * 1024
// 统计集合上限,超过后自动清空重新计数,防止长时间播放无限增长
const statCap = 100000

export default class {

    private c: RTCPeerConnection;
    private dc: RTCDataChannel | null = null;
    private tx: number = 0
    private rx: number = 0
    private restart: number = 0
    private createtime: number = 0;
    private activetime: number = 0;
    private readonly isServer: boolean;
    private speed: number = 0; // 链接速度,如果接收超过2MB,仍没有算出速度，很可能是丢包严重
    private localAddress: string | null = null;
    private localPort: number | null = null;
    private remoteAddress: string | null = null;
    private remotePort: number | null = null;

    private relay: boolean = false;
    private relatedAddress: string | null = null;
    private relatedPort: number | null = null;

    // 我们给对方发送一个offer,对方可能连续回复3个answer,我们使用此队列执行
    private ansTaskQueue: Promise<any> = Promise.resolve();


    // 缓存分包的rtc数据，收到完整的一个包后清理缓存
    private buffers: Map<string, Array<rtcRecv>> = new Map()

    private resolveParts: Set<string> = new Set(); // 共计发送过多少个part的请求,如果有取消的，则会减去, 按照 vid:sn 的格式存储
    private responseParts: Set<string> = new Set(); // 共计收到的parts计数

    // 对端图解
    private hosts: hostsMap = {}
    private selfHosts: string = ''
    private hostsTimer: number = 0;

    // 对方发送的索要请求 任务定时器，轮询60内的任务，
    private resolveTasks: Array<resolveTask> = [];
    private readonly resolveTaskTimer: number;
    // 我们向外发出的索要请求，如果发现我们已经有了，也自动发送quit
    private queryTasks: Map<string, resolveTask> = new Map();

    // buffer发送队列
    private bufferQueue: Array<bufferItem> = [];
    private bufferItemSending: bufferItem | null = null;
    private queuerunning = false;

    // 半包的数量，越大丢包越严重
    private packet: Set<string> = new Set(); // vid:sn 的格式

    private readonly $ws: ws;
    private readonly me = uuid();
    private readonly destroy_fn: EventListenerOrEventListenerObject = () => { }

    // trigger open/close/error/message
    constructor(public readonly id: string, private readonly opts: rtcConfig, private readonly trigger: (type: string, data: Object) => void) {
        this.destroy_fn = this.destroy.bind(this);
        this.isServer = isServer(id)
        this.$ws = singal(opts.tracker);
        this.c = new RTCPeerConnection(this.opts.rtcConf);
        this.init();
        this.resolveTaskTimer = setInterval(() => this.doTask(), 600 + Math.random() * 200);
    }


    public destroy() {
        clearTimeout(this.restart);
        clearInterval(this.resolveTaskTimer);
        clearInterval(this.hostsTimer);
        // 移除dcInit时挂在window上的生命周期监听
        window.removeEventListener('pagehide', this.destroy_fn)
        window.removeEventListener('beforeunload', this.destroy_fn)
        try {
            if (this.dc) {
                this.dc.onopen = null
                this.dc.onmessage = null
                this.dc.onclose = null
                this.dc.onbufferedamountlow = null
                this.dc.onerror = null
                this.dc.close()
            }
            if (this.c) {
                this.c.onnegotiationneeded = null;
                this.c.ondatachannel = null;
                this.c.onconnectionstatechange = null;
                this.c.onicecandidateerror = null;
                this.c.onicegatheringstatechange = null;
                this.c.oniceconnectionstatechange = null;
                this.c.onicecandidate = null;
                this.c.close()
            }
        } catch (e) {
            log_log(e)
        } finally {
            (this.dc as any) = null;
            (this.c as any) = null;
        }
    }

    get cansend(): boolean {
        return this.dc?.readyState == 'open';
    }

    /**
     * 检查是否正在进行 SDP 协商
     * 在协商过程中禁止重新初始化连接，避免竞态条件
     */
    private isNegotiating(): boolean {
        if (!this.c) return false;
        const state = this.c.signalingState;
        return state === 'have-local-offer' ||
               state === 'have-remote-offer' ||
               state === 'have-local-pranswer' ||
               state === 'have-remote-pranswer';
    }

    private init() {
        if (this.c) {
            try {
                this.c.onnegotiationneeded = null;
                this.c.ondatachannel = null;
                this.c.onconnectionstatechange = null;
                this.c.onicecandidateerror = null;
                this.c.onicegatheringstatechange = null;
                this.c.oniceconnectionstatechange = null;
                this.c.onicecandidate = null;
                this.c.close()
            } catch (e) {
                log_log(e)
            }
        }
        this.createtime = Date.now();
        this.c = new RTCPeerConnection(this.opts.rtcConf);
        this.c.onnegotiationneeded = async (ev: Event) => {
            log_log(ev)
            try {
                const offer = await this.c.createOffer();
                // 当本地通过 createOffer 生成 local SDP 后会再调用 setLocalDescription 设置到本地描述信息中，setLocalDescription 中就会进行 candidate 收集。
                // setLocalDescription 中会触发 candidate 是异步的， 但我们不能保证他是在 await this.c.setLocalDescription 之后触发的
                // 此处需要先发送offer,后setLocalDescription， 以保证对端是先收到offer,后收到candidate
                this.$ws.sendJson({ event: 'offer', to: this.id, from: this.me, data: offer })
                await this.c.setLocalDescription(offer)
            } catch (e) {
                log_warn(e)
            }
        }

        this.c.ondatachannel = (ev: RTCDataChannelEvent) => {
            // 对方建立了 datachannel, 我方收到就维护起来
            if (this.dc) {
                try {
                    this.dc.onopen = null
                    this.dc.onmessage = null
                    this.dc.onclose = null
                    this.dc.onbufferedamountlow = null
                    this.dc.onerror = null
                    this.dc.close()
                } catch (e) {
                    log_log(e)
                }
            }
            this.dc = ev.channel
            this.dc.binaryType = 'arraybuffer'
            this.dc.bufferedAmountLowThreshold = rtcMax
            this.dcInit(this.dc)
            log_log(ev)
        }
        this.c.onconnectionstatechange = (ev: Event) => {
            log_log(ev)
        }
        this.c.onicecandidateerror = (ev: Event) => {
            log_log(ev)
        }

        this.c.onicegatheringstatechange = (ev: Event) => {
            log_log(ev)
        }

        this.c.oniceconnectionstatechange = (ev: Event) => {
            log_log(ev)
        }

        this.c.onicecandidate = (ev) => {
            if (ev.candidate) {
                if (ev.candidate.type == 'host') {
                    // 本机
                    this.localAddress = ev.candidate.address
                    this.localPort = ev.candidate.port
                }
                if (ev.candidate.type == "srflx") {
                    // The STUN server is reachable!
                    this.localAddress = ev.candidate.address;
                    this.localPort = ev.candidate.port;
                }

                // If a relay candidate was found, notify that the TURN server works!
                // 仅代表中继服务器可用，并不一定最终使用了中继
                if (ev.candidate.type == "relay") {
                    this.relatedAddress = ev.candidate.address;
                    this.relatedPort = ev.candidate.port;
                }

                const data = {
                    event: 'candidate',
                    from: this.me,
                    to: this.id,
                    data: ev.candidate
                }
                this.$ws.sendJson(data)
            }
        }
    }

    // 1. 对于发送任务更新地方 1.收到quit消息 2.发现已超时 3. 队列已调用发送
    // 2. 对于我们索要的，如果我们已经有了，则发送quit
    // 即使已经断线，这些数据也要正常维护
    private doTask() {
        const t = Date.now();
        this.resolveTasks = this.resolveTasks.filter((item) => {
            // 如果查找到了，则回复给他，然后清理这个任务
            const buf = globalBuffer.get(item.id, item.sn)
            if (buf && this.cansend) {
                // 此处虽然重复调用，但是后续callQueue会自动去重
                // 因为callQueue也对resolveTasks修改了，如果是同步执行在filter内无效，需要异步
                setTimeout(() => this.callQueue(buf), 0)
            }
            // 如果是时间相差比较久的，自动放弃这个任务，超过60s还未解决的
            if (t - item.t > 60e3) {
                return false
            }
            return true;
        })

        // 2. 对我们已经发出去请求，但是我们现在已经持有的，发送quit消息;如果这个索要请求是60s前发送的，则无需发送quit,默认已失效了
        const q: Map<string, Set<number>> = new Map();
        for (const [k, item] of this.queryTasks.entries()) {
            const buf = globalBuffer.get(item.id, item.sn)
            if (buf) {
                const v = q.get(item.id)
                if (v) {
                    v.add(item.sn)
                } else {
                    q.set(item.id, new Set([item.sn]))
                }
                this.queryTasks.delete(k)
                continue;
            }
            if (t - item.t > 60e3) {
                this.queryTasks.delete(k)
            }
        }
        // 根据上面的分析，发送quit消息
        if (!this.cansend) {
            return
        }
        for (const [id, parts] of q) {
            const qmsg = JSON.stringify({ event: 'quit', data: { id, parts: Array.from(parts) } as rtcParts })
            if (this.send(qmsg)) {
                parts.forEach((sn) => {
                    this.resolveParts.delete(`${id}:${sn}`);
                })
            }
            // log_log(qmsg)
        }
        this.calcPacket();
    }

    // 我主动链接这个ID
    private connect() {
        clearTimeout(this.restart)
        this.init()
        if (this.dc) {
            try {
                this.dc.close()
            } catch (e) {
                log_warn(e)
            }
        }
        this.dc = this.c.createDataChannel("dc", { maxRetransmits: 5, ordered: false })
        this.dc.binaryType = 'arraybuffer'
        this.dc.bufferedAmountLowThreshold = rtcMax;
        this.dcInit(this.dc)
    }

    // 检查链接状态，如果发送ping,未能及时收到pong,则会重连
    public checkConn() {
        if (this.c && this.c.connectionState == 'connected' && this.cansend) {
            const pmsg = JSON.stringify({ event: 'ping' })
            this.send(pmsg)
            log_log(pmsg)
            clearTimeout(this.restart)
            // 如果我们5秒内收到响应了（pong）,则重连任务将会取消
            this.restart = setTimeout(() => this.connect(), 5e3)
        } else if (!this.isNegotiating()) {
            // 只有在非 SDP 协商状态时才允许重连，避免竞态条件导致 createAnswer 错误
            this.connect();
        } else {
            log_log(this.id, 'checkConn skipped: SDP negotiating, state=', this.c?.signalingState);
        }
    }

    private sendHosts(force = false) {
        // 当前链接的是个ServerPeer,则不用给他发送
        if (!this.cansend) {
            return
        }
        if (this.isServer) {
            return
        }
        const hosts = globalBuffer.hosts()
        const str = JSON.stringify({ event: 'hosts', data: hosts })
        if (!force && (str == this.selfHosts)) {
            return
        }
        if (this.send(str)) {
            this.selfHosts = str;
        }
    }

    private dcInit(dc: RTCDataChannel) {
        // https://www.igvita.com/2015/11/20/dont-lose-user-and-app-state-use-page-visibility/
        // 微信关闭webview,执行pagehide,不走beforeunload
        // unload已被废弃且受Permissions-Policy限制(触发violation告警),pagehide是其可靠替代,故不再注册unload
        window.addEventListener('pagehide', this.destroy_fn)
        window.addEventListener('beforeunload', this.destroy_fn)
        dc.onopen = (e) => {
            this.isUsedRelay();
            this.trigger('open', { id: this.id, data: e });
            this.activetime = Date.now()
            this.sendHosts(true)
            clearInterval(this.hostsTimer)
            this.hostsTimer = setInterval(() => this.sendHosts(), 15e3)
        }
        dc.onclose = e => {
            log_log("dc close " + this.id, e)
            this.trigger('close', { id: this.id, data: e });
        }
        dc.onerror = e => {
            log_warn("dc error " + this.id, e)
            this.trigger('error', { id: this.id, data: e });
        }
        dc.onbufferedamountlow = () => {
            // 如果我们有发送任务，在此处发送
        }
        dc.onmessage = async (e) => {
            // 如果有重连任务，取消他
            clearTimeout(this.restart)
            let data = e.data;
            if (data instanceof Blob) {
                // 火狐浏览器始终是blob格式,这里修正
                data = await e.data.arrayBuffer()
            }
            if (data instanceof ArrayBuffer) {
                this.rx += data.byteLength
            } else {
                this.rx += data.length
            }
            this.activetime = Date.now()
            try {
                this.extract(data)
            } catch (err) {
                // decode对坏包/协议版本不符会抛异常,不能让onmessage产生unhandled rejection
                log_warn(err)
            }
        }
    }

    // trigger message/buffer/buffer.recv
    private extract(data: ArrayBuffer | string) {
        if (!(data instanceof ArrayBuffer)) {
            let info: any;
            try {
                info = JSON.parse(data)
            } catch (e) {
                return log_warn(e)
            }

            switch (info.event) {
                case 'hosts':
                    this.hosts = info.data as hostsMap
                    return
                case 'ping':
                    const pmsg = JSON.stringify({ event: 'pong' })
                    this.send(pmsg)
                    // log_log(pmsg)
                    return
                case 'pong':
                    return
                case 'resolve':
                    {
                        // 对端批量查询了，我们批量回复
                        const data = info.data as rtcParts;
                        const id: string = data.id;
                        const parts: Array<number> = data.parts
                        const t = Date.now()
                        for (const sn of parts) {
                            // 无论我们是否持有此buffer,将此请求加入到检查队列，当我们持有时会发送给他，因为有些buffer可能我们现在就已经持有，为保证及时，故立即doTask
                            // 在60s内如果我们拥有了，则会发送给他，如果太久则自动放弃
                            this.resolveTasks.push({
                                id,
                                t,
                                sn,
                            })
                        }
                        this.doTask()
                        this.trigger('prefetch', data)
                    }
                    return
                case 'quit':
                    {
                        // 对方之前索要过，但是现在要放弃，必然是对方60s内发送过索要请求，如果对方发送索要请求超过60s,则对方无需发送quit
                        const data = info.data as rtcParts;
                        const id: string = data.id;
                        const parts: Array<number> = data.parts
                        this.resolveTasks = this.resolveTasks.filter(item => {
                            if (item.id == id && parts.includes(item.sn)) {
                                return false
                            }
                            return true
                        })
                    }
                    return
            }
            return this.trigger('message', { data, id: this.id })
        }
        const info: rtcRecv = decode(data)
        const bufKey = info.id + ':' + info.sn
        const item = this.buffers.get(bufKey)
        if (item) {
            item[info.i] = info
        } else {
            const b: Array<rtcRecv> = [];
            b[info.i] = info
            this.buffers.set(bufKey, b)
        }
        // 我们发出的请求得到回应了，我们清理这个进行中的队列
        this.queryTasks.delete(bufKey)
        // 分片传输中,可用于进度提示
        this.trigger('buffer.recv', { data: info, id: this.id } as rtcProgressInfo)
        let done = true;
        const c = this.buffers.get(bufKey) as rtcRecv[]
        for (let j = 0; j < info.n; j++) {
            if (!c[j]) {
                done = false
                break
            }
        }
        if (!done) {
            return
        }
        // 全部分片已持有,合并所有分片
        let buffers: ArrayBuffer = concatArrayBuffers(c.map(i => i.data))
        const times: Array<number> = c.map(i => i.t);
        this.buffers.delete(bufKey)
        // 分片已完整接收,同步清理丢包记录
        this.packet.delete(bufKey)
        const timeCost = Math.max(...times) - Math.min(...times);
        this.speed = Math.round((buffers.byteLength / 1024) / (timeCost < 1 ? 1 : timeCost / 1000));
        let partItem: bufferItem | undefined = globalBuffer.get(info.id, info.sn)
        const newly = !partItem
        if (newly) {
            partItem = {
                id: info.id,
                part: info.sn,
                buffer: buffers
            }
            globalBuffer.put(partItem)
        }
        this.responseParts.add(`${info.id}:${info.sn}`);
        if (this.responseParts.size > statCap) {
            this.responseParts.clear()
        }
        this.trigger('buffer', { data: partItem, newly, server: this.isServer, id: this.id } as rtcBufferItem)
        log_log("接收分片", info.sn, "来自", this.id, "速度", this.speed, "newly", newly)
    }

    // 媒体数据使用此列队发送，其他数据可以直接发送
    private async callQueue(data: bufferItem) {
        const has = this.bufferQueue.find(it => it.id == data.id && it.part == data.part)
        if (!has) {
            // 如果不在队列里，再判断一次，是否是我们已经从队列里取出来了，在等待发送队列buffer
            if (!this.bufferItemSending || !(this.bufferItemSending.id == data.id && this.bufferItemSending.part == data.part)) {
                this.bufferQueue.push(data)
            }
        }
        if (this.queuerunning) {
            return
        }
        try {
            this.queuerunning = true
            while (this.bufferItemSending = this.bufferQueue.shift() as bufferItem) {
                if (!this.dc || !this.cansend) {
                    this.bufferQueue.length = 0
                    return
                }
                const bufgoing = this.bufferItemSending;
                // 如果至少有一小块buffer 1MB,还停留在发送队列，则继续等待
                while (this.dc?.bufferedAmount > rtcMax * 16) {
                    await sleep(500)
                    if (!this.dc || !this.cansend) {
                        this.bufferQueue.length = 0
                        return
                    }
                }
                // 检查此任务是否已quit
                const exist = this.resolveTasks.find(it => it.id == bufgoing.id && it.sn == bufgoing.part)
                if (!exist) {
                    continue
                }
                if (!this.sendBuffer(bufgoing)) {
                    // dc发送失败(连接已不可用),后续分片也不可能发出,清空整个发送队列等待重连后重新索要
                    this.bufferQueue.length = 0
                    return
                }
                // 调用完发送后，需要清理检查队列
                this.resolveTasks = this.resolveTasks.filter(it => !(it.id == bufgoing.id && it.sn == bufgoing.part))
            }

        } finally {
            this.queuerunning = false
            // 队列已空,必须清空正在发送标记,否则后续对同一分片的请求(如重传)会被去重逻辑误判为正在发送而永远无法入队
            this.bufferItemSending = null
        }

    }

    // 计算丢包率, 考虑要求重传
    // 当一个数据包（半包）最近的时间距离现在已超过5s,则考虑要求对方重传
    // 在peer层面，如果我们收到半包说明对方持有，但是网络差，这里我们要求peer重传，上层有逻辑换其他peer重试，互不影响
    // 要求重传时，不计入resolveParts， 重传逻辑类似于下面的 resolve
    // 由doTask调用，基本上每秒都会执行一次
    private calcPacket(): number {
        interface baseFragment {
            id: string
            sn: number
        };
        const n = Date.now();
        const half_packet: Map<string, baseFragment> = new Map();
        for (const [bufKey, c] of this.buffers) {
            const info = c.find(it => it)
            if (!info) {
                continue
            }
            // 如果已有其他peer或http完成，则清除本peer里的数据
            let half = false
            for (let j = 0; j < info.n; j++) {
                if (!c[j]) {
                    // 是一个半包,我们检查每个元素的时间
                    const times = c.filter(i => i).map(i => i.t)
                    if (n - Math.max(...times) > 5e3) {
                        // 这个半包的离我们最近的一个分片也超过5s，视为丢包
                        half = true
                        break
                    }
                }
            }
            if (half) {
                this.packet.add(`${info.id}:${info.sn}`)
                if (this.packet.size > statCap) {
                    this.packet.clear()
                }
                // 距最早收到的分片已超过60s仍未收齐(与resolveTasks/queryTasks的60s时效对齐),
                // 放弃这个半包:清理缓存,不再进入下面的5s重传循环,避免对永远收不齐的包无限重发resolve
                const allTimes = c.filter(i => i).map(i => i.t)
                if (n - Math.min(...allTimes) > 60e3) {
                    this.buffers.delete(bufKey)
                    continue
                }
                const buf = globalBuffer.get(info.id, info.sn)
                if (buf) {
                    // 如果在全局buffer里找到说明其他peer或http完成了任务，我们清理本peer的半包数据，但是丢包仍然是计算在内的
                    this.buffers.delete(bufKey)
                } else {
                    half_packet.set(bufKey, { id: info.id, sn: info.sn, })
                }
            }
        }
        const size = half_packet.size
        if (size < 1) {
            return 0
        }
        if (this.isServer) {
            // 如果是服务端，出现半包，则不要求服务端重传了，这样我们也不需要记录每个sn对应的URL了
            return size;
        }

        const client_data: Map<string, Array<number>> = new Map();
        // 对于丢包5s后的我们发起重传要求,还要判断是否刚刚是否已发送过
        for (const [bufKey, item] of half_packet.entries()) {
            const qinfo = this.queryTasks.get(bufKey) // 查询什么时间发送resolve消息的
            if (qinfo && n - qinfo.t < 5e3) {
                // 最近刚刚向他发送过索要请求
                continue;
            }
            let sn_arr = client_data.get(item.id)
            if (sn_arr) {
                sn_arr.push(item.sn)
            } else {
                sn_arr = [item.sn]
                client_data.set(item.id, sn_arr)
            }
        }

        for (const [k, v] of client_data) {
            const msg = JSON.stringify({ event: 'resolve', data: { id: k, parts: v } as rtcParts })
            if (this.send(msg)) {
                log_info("retry", msg)
                for (const it of v) {
                    this.queryTasks.set(`${k}:${it}`, {
                        id: k,
                        t: n,
                        sn: it
                    })
                }
            }
        }
        return size
    }


    private sendBuffer(data: bufferItem): boolean {
        const datas = this.splitBuffer(data)
        for (let i = 0; i < datas.length; i++) {
            const item = datas[i]
            if (!this.send(item)) {
                return false;
            }
        }
        // 如果未加入发送缓冲，则不触发事件
        emit('rtc-sent', this.id, data)
        return true
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

    // 别人发送我们offer,我们响应answer
    public async onOffer(sdp: RTCSessionDescription) {
        const conn = this.c;
        this.ansTaskQueue = this.ansTaskQueue.then(async () => {
            try {
                if (this.c.connectionState === 'closed' || conn !== this.c) return;
                await this.c.setRemoteDescription(sdp);
                const s = this.c.signalingState;
                // 必须是 have-remote-offer 才能 createAnswer
                // Failed to execute 'createAnswer' on 'RTCPeerConnection': PeerConnection cannot create an answer in a state other than have-remote-offer or have-local-pranswer.
                if (s !== 'have-remote-offer' && s !== 'have-local-pranswer') {
                    log_warn(this.id, "state invalid after setRemoteDescription:", s);
                    return;
                }
                const answer = await this.c.createAnswer();
                const data = {
                    event: "answer",
                    from: this.me,
                    to: this.id,
                    data: answer,
                };
                this.$ws.sendJson(data);
                await this.c.setLocalDescription(answer);
            } catch (e) {
                console.error("onOffer error:", this.id, e);
            }
        })
        return await this.ansTaskQueue;
    }

    // 我们发送一个offer请求，对方可能连续回复我们3个answer, ice-ufrag和ice-pwd不同
    // 我们需要顺序处理这些,我们使用一个Promise串行起来
    // Failed to execute 'setRemoteDescription' on 'RTCPeerConnection': Failed to set remote answer sdp: Called in wrong state: stable
    public async onAnswer(sdp: RTCSessionDescription) {
        const conn = this.c;
        this.ansTaskQueue = this.ansTaskQueue.then(async () => {
            try {
                if (this.c.connectionState === 'closed' || conn !== this.c) return;
                // 此时正确是this.c.signalingState应该是=have-local-offer
                // 如果已经是stable时，则忽略调用
                if (this.c.signalingState === 'stable') {
                    return;
                }
                return await this.c.setRemoteDescription(sdp)
            } catch (e) {
                console.error(e)
            }
        });
        return await this.ansTaskQueue;
    }

    public async onCandidate(candidate: RTCIceCandidate) {
        let s = 100;
        const info = candidateInfo(candidate.candidate)
        if (info) {
            if (info.type == 'host') {
                // 本机
                this.remoteAddress = info.address
                this.remotePort = Number(info.port)
            }
            if (info.type == "srflx") {
                // The STUN server is reachable!
                this.remoteAddress = info.address
                this.remotePort = Number(info.port)
            }
            // If a relay candidate was found, notify that the TURN server works!
            // 仅代表中继服务器可用，并不一定最终使用了中继
            if (info.type == "relay") {
                this.relatedAddress = info.address
                this.relatedPort = Number(info.port)
                s = 200
            }
        }
        await sleep(s)
        // Failed to execute 'addIceCandidate' on 'RTCPeerConnection': The remote description was null
        return await this.ansTaskQueue.then(async () => {
            try {
                // TODO 或许要处理 this.c.signalingState = closed
                // 我们等待至少有一个onAnswer（setRemoteDescription）调用后 （ 我方主动发offer的情况 ）
                // 或者 onOffer 被调用 （ 我方收到offer的情况 ）
                // 上述两种情况是走其一的,所以我们都是使用 ansTaskQueue串行起来
                // 如果还有 The remote description was null ，则说明之前没有onOffer或onAnswer,可能是新建的peer,立即onCandidate了
                // 这可能是消息candidate消息先到达了 ( 排查到可能是，我方上线后，对方发给我offer,后续又将发送多个candidate给我，但是我此刻刷新了，导致新上线后，上次要给我发的candidate立刻到达了，后续又发了offer )
                // 如此只能忽略掉这个candidate
                if (!this.c.remoteDescription) {
                    log_warn(this.id, 'no offer or answer,ignore candidate', candidate)
                    return
                }
                return await this.c.addIceCandidate(candidate)
            } catch (e) {
                console.error(this.id, e)
            }
        })
    }

    // 发送索要请求,上层需要判断是在线了才能调用，20秒内最好不重复发送
    // 如果向对方索要时，已发现对方也在向我们索要，则存在双方进度相同，相互guess的情况，此时，后guess的用户立即发起http下载
    public resolve(id: string, parts: Set<fragment>): Set<fragment> {
        const guessed_eachother: Set<fragment> = new Set();
        const want = this.get_want(id)
        const data: Array<any> = [];
        for (const item of parts) {
            data.push(this.isServer ? { part: item.sn, url: item.url } : item.sn)
            if (want.has(item.sn)) {
                guessed_eachother.add(item)
            }
        }
        const rmsg = JSON.stringify({ event: 'resolve', data: { id, parts: data } as rtcParts })
        if (!this.send(rmsg)) {
            return guessed_eachother
        }
        // log_log(rmsg)
        const t = Date.now()
        for (const part of parts) {
            const kk = `${id}:${part.sn}`;
            this.resolveParts.add(kk)
            if (this.resolveParts.size > statCap) {
                this.resolveParts.clear()
            }
            this.queryTasks.set(kk, {
                id,
                t,
                sn: part.sn
            })
        }
        return guessed_eachother
    }

    // 获取针对这个视频id,对方peer想要的分片
    private get_want(vid: string): Set<number> {
        const s: Set<number> = new Set()
        this.resolveTasks.forEach(({ id, sn }) => {
            if (vid == id) {
                s.add(sn)
            }
        })
        return s;
    }

    // 如果链接状态正常且成功加入发送缓冲区，则返回true,否则false
    private send(data: any): boolean {
        if (!this.dc || !this.cansend) {
            log_log("data channel to " + this.id + " is not avaiable", this.dc ? this.dc.readyState : 'not ready')
            return false
        }
        try {
            this.dc.send(data)
            if (data instanceof ArrayBuffer) {
                this.tx += data.byteLength
            } else {
                this.tx += data.length
            }
            return true
        } catch (e) {
            log_warn(e)
            // 只有在非 SDP 协商状态时才允许重连，避免竞态条件
            if (!this.isNegotiating()) {
                this.connect()
            }
            return false
        }

    }

    // 计算最终是否使用了中继
    private async isUsedRelay() {
        try {
            // onopen触发时连接可能已被重连/销毁重建,此时c已换新或为null,直接放弃本次统计
            if (!this.c) {
                return false
            }
            const stats: any = await this.c.getStats()
            let selectedLocalCandidate: string = ''
            for (const { type, state, localCandidateId } of stats.values()) {
                if (type === 'candidate-pair' && state === 'succeeded' && localCandidateId) {
                    selectedLocalCandidate = localCandidateId
                    break
                }
            }
            this.relay = (Boolean(selectedLocalCandidate) && stats.get(selectedLocalCandidate)?.candidateType === 'relay')
            if (this.relay) {
                log_info("use relay", this, stats.get(selectedLocalCandidate))
            }
            return this.relay;
        } catch (e) {
            log_warn(e)
            return false
        }
    }

    public stat(): peerStat {
        return {
            tx: this.tx,
            rx: this.rx,
            state: this.dc ? this.dc.readyState : null,
            cstate: this.c ? this.c.connectionState : null, // firefox 下值可能为undefined
            istate: this.c ? this.c.iceConnectionState : null,
            gstate: this.c ? this.c.iceGatheringState : null,
            bufferedAmount: this.dc ? this.dc.bufferedAmount : 0,
            createtime: this.createtime,
            activetime: this.activetime,
            isServer: this.isServer,
            speed: this.speed,
            hosts: this.hosts,
            localAddress: this.localAddress,
            localPort: this.localPort,
            remoteAddress: this.remoteAddress,
            remotePort: this.remotePort,
            relay: this.relay,
            relatedAddress: this.relatedAddress,
            relatedPort: this.relatedPort,
            packet: this.packet.size,
            resolveParts: this.resolveParts.size, // 索要过多少part,中途取消的会减去，回复率大于100%可能是取消的消息太迟，对方还是发来了
            responseParts: this.responseParts.size, // 真实的接收到多少个part，回复率小于100%可能是服务端无响应或中途存在断线，漏消息
        }
    }

}

