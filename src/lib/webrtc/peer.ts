import { concatArrayBuffers, log_log, uuid, log_warn, sleep, emit } from '../../util/util'
import singal, { candidateInfo, decode, encode, isServer } from './util'
import { globalBuffer } from "../../util/bufferCenter";
import { bufferItem, config, fragment, hostsMap, peerStat, resolveTask, rtcBufferItem, rtcProgressInfo, rtcRecv } from '../../types';
import ws from '../../util/ws';

const rtcMax = 60 * 1024
let localAddress: string;

export default class {

    private c: RTCPeerConnection
    private dc: RTCDataChannel;
    private tx: number = 0
    private rx: number = 0
    private restart: number = 0
    private activetime: number = 0;
    private isServer: boolean;
    private speed: number = 0; // 链接速度,如果接收超过2MB,仍没有算出速度，很可能是丢包严重
    private localAddress: string;
    private localPort: number;
    private remoteAddress: string;
    private remotePort: number;

    private relay: boolean = false;
    private relatedAddress: string;
    private relatedPort: number;


    // 缓存分包的rtc数据，收到完整的一个包后清理缓存
    private buffers: Map<string, Array<rtcRecv>> = new Map()

    // 对端图解
    private hosts: hostsMap = {}
    private selfHosts: string
    private hostsTimer: number;

    // 任务定时器，轮询60内的任务，
    private resolveTasks: Array<resolveTask> = [];
    private resolveTaskTimer: number;
    // 我们的请求任务，如果发现我们已经有了，也自动发送quit
    private queryTasks: Array<resolveTask> = [];

    // buffer发送队列
    private bufferQueue: Array<bufferItem> = [];
    private queuerunning = false

    // 半包的数量，越大丢包越严重
    private packet: number;

    private $ws: ws;
    private me = uuid();


    // trigger open/close/error/message
    constructor(public readonly id: string, private readonly opts: config, private readonly trigger: (type: string, data: Object) => void) {
        this.isServer = isServer(id)
        this.$ws = singal(opts.tracker)
        this.init()
        this.resolveTaskTimer = setInterval(() => this.doTask(), 600);
    }


    public destroy() {
        clearInterval(this.resolveTaskTimer);
        clearInterval(this.hostsTimer);
    }

    get cansend(): boolean {
        return this.dc && this.dc.readyState == 'open'
    }

    private init() {
        if (this.c) {
            try {
                this.c.close()
            } catch (e) {
                log_log(e)
            }
        }
        this.c = new RTCPeerConnection(this.opts.rtcConf);
        this.c.onnegotiationneeded = async (ev: Event) => {
            log_log(ev)
            try {
                const offer = await this.c.createOffer();
                await this.c.setLocalDescription(offer)
                // send sdp to ws server
                this.$ws.sendJson({ event: 'offer', to: this.id, from: this.me, data: offer })
            } catch (e) {
                log_warn(e)
            }
        }

        this.c.ondatachannel = (ev: RTCDataChannelEvent) => {
            // 对方建立了 datachannel, 我方收到就维护起来
            if (this.dc) {
                try {
                    this.dc.close()
                } catch (e) {
                    log_log(e)
                }
            }
            this.dc = ev.channel
            this.dc.binaryType = 'arraybuffer'
            this.dc.bufferedAmountLowThreshold = rtcMax
            this.dcInit()
            log_log(ev)
        }
        this.c.onconnectionstatechange = (ev: Event) => {
            log_log(ev)
        }
        this.c.onicecandidateerror = (ev: Event) => {
            log_warn(ev)
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
                    localAddress = ev.candidate.address;
                    this.localAddress = localAddress
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

    public waitForConnect() {
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
                // 此处虽然重复调用，但是后续会自动去重
                this.callQueue(buf);
            }
            // 如果是时间相差比较久的，自动放弃这个任务，超过60s还未解决的
            if (t - item.t > 60e3) {
                return false
            }
            return true;
        })

        // 2. 对我们已经发出去请求，但是我们现在已经持有的，发送quit消息;如果这个索要请求是60s前发送的，则无需发送quit,默认已失效了
        const q: Map<string, Set<number>> = new Map();
        this.queryTasks = this.queryTasks.filter(item => {
            const buf = globalBuffer.get(item.id, item.sn)
            if (buf) {
                const v = q.get(item.id)
                if (v) {
                    v.add(item.sn)
                } else {
                    q.set(item.id, new Set([item.sn]))
                }
                return false
            }
            if (t - item.t > 60e3) {
                return false
            }
            return true
        })
        // 根据上面的分析，发送quit消息
        if (!this.cansend) {
            return
        }
        for (const [id, parts] of q) {
            this.send(JSON.stringify({ event: 'quit', data: { id, parts: Array.from(parts) } }))
        }
        this.packet = this.calcPacket();
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
        this.dc = this.c.createDataChannel("dc", { maxPacketLifeTime: 9e3, ordered: false })
        this.dc.binaryType = 'arraybuffer'
        this.dc.bufferedAmountLowThreshold = rtcMax;
        this.dcInit()
    }

    checkConn() {
        if (this.c && this.c.connectionState == 'connected' && this.cansend) {
            this.send(JSON.stringify({ event: 'ping' }))
            clearTimeout(this.restart)
            // 如果我们5秒内收到响应了（pong）,则重连任务将会取消
            this.restart = setTimeout(() => this.connect(), 5e3)
        } else {
            this.connect();
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
        this.send(str);
        this.selfHosts = str;
    }

    private dcInit() {
        window.addEventListener('beforeunload', () => {
            this.c.close()
            this.dc.close()
        })
        this.dc.onopen = (e) => {
            this.isUsedRelay();
            this.trigger('open', { id: this.id, data: e });
            this.activetime = Date.now()
            this.sendHosts(true)
            clearInterval(this.hostsTimer)
            this.hostsTimer = setInterval(() => this.sendHosts(), 15e3)
        }
        this.dc.onclose = e => {
            log_warn("dc close " + this.id, e)
            this.trigger('close', { id: this.id, data: e });
        }
        this.dc.onerror = e => {
            log_warn("dc error " + this.id, e)
            this.trigger('error', { id: this.id, data: e });
        }
        this.dc.onbufferedamountlow = () => {
            // 如果我们有发送任务，在此处发送
        }
        this.dc.onmessage = async (e) => {
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
            this.extract(data)
        }
    }

    // trigger message/buffer/buffer.recv
    private extract(data: ArrayBuffer | string) {
        if (!(data instanceof ArrayBuffer)) {
            const info = JSON.parse(data)
            switch (info.event) {
                case 'hosts':
                    this.hosts = info.data as hostsMap
                    return
                case 'ping':
                    this.send(JSON.stringify({ event: 'pong' }))
                    return
                case 'pong':
                    return
                case 'resolve':
                    {
                        // 对端批量查询了，我们批量回复
                        const id: string = info.data.id;
                        const parts: Array<number> = info.data.parts
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
                    }
                    return
                case 'quit':
                    {
                        // 对方之前索要过，但是现在要放弃，必然是对方60s内发送过索要请求，如果对方发送索要请求超过60s,则对方无需发送quit
                        const id: string = info.data.id;
                        const parts: Array<number> = info.data.parts
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
        this.queryTasks = this.queryTasks.filter((it) => {
            if (it.id == info.id && it.sn == info.sn) {
                return false
            }
            return true
        })
        // 分片传输中,可用于进度提示
        this.trigger('buffer.recv', { data: info, id: this.id } as rtcProgressInfo)
        let done = true;
        const c = this.buffers.get(bufKey)
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
        let buffers: ArrayBuffer = c[0].data
        const times: Array<number> = [c[0].t];
        for (let j = 1; j < info.n; j++) {
            buffers = concatArrayBuffers(buffers, c[j].data)
            times.push(c[j].t)
        }
        this.buffers.delete(bufKey)
        const timeCost = Math.max(...times) - Math.min(...times);
        this.speed = Math.round((buffers.byteLength / 1024) / (timeCost < 1 ? 1 : timeCost / 1000));
        let partItem: bufferItem = globalBuffer.get(info.id, info.sn)
        const newly = !partItem
        if (!partItem) {
            partItem = {
                id: info.id,
                part: info.sn,
                buffer: buffers
            }
            globalBuffer.put(partItem)
        }
        this.trigger('buffer', { data: partItem, newly, server: this.isServer, id: this.id } as rtcBufferItem)
        log_log("接收分片", info.sn, "来自", this.id, "速度", this.speed, "newly", newly)
    }

    // 媒体数据使用此列队发送，其他数据可以直接发送
    private async callQueue(data: bufferItem) {
        const has = this.bufferQueue.find(it => it.id == data.id && it.part == data.part)
        if (!has) {
            this.bufferQueue.push(data)
        }
        if (this.queuerunning) {
            return
        }
        const max = rtcMax * 5; // max 5MB buffer
        let item: bufferItem;
        try {
            this.queuerunning = true
            while (item = this.bufferQueue.shift()) {
                if (!this.dc || !this.cansend) {
                    this.bufferQueue.length = 0
                    return
                }
                while (this.dc.bufferedAmount > max) {
                    await sleep(500)
                }
                // 检查此任务是否已quit
                const exist = this.resolveTasks.find(it => it.id == item.id && it.sn == item.part)
                if (!exist) {
                    continue
                }
                this.sendBuffer(item)
                // 调用完发送后，需要清理检查队列
                this.resolveTasks = this.resolveTasks.filter(it => !(it.id == item.id && it.sn == item.part))
            }

        } finally {
            this.queuerunning = false
        }

    }

    // 计算丢包率,一般情况下
    private calcPacket(): number {
        let num = 0;
        for (const [_, c] of this.buffers) {
            let done = true
            const info = c.find(it => it)
            for (let j = 0; j < info.n; j++) {
                if (!c[j]) {
                    done = false
                    break
                }
            }
            if (!done) {
                num++
            }
        }
        return num
    }

    private sendBuffer(data: bufferItem) {
        const datas = this.splitBuffer(data)
        for (let i = 0; i < datas.length; i++) {
            const item = datas[i]
            this.send(item)
        }
        emit('rtc-sent', this.id, data)
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

    public async onOffer(sdp: RTCSessionDescription) {
        if (this.c.signalingState == 'closed') {
            log_warn("onOffer error signalingState is closed");
            return
        }
        await this.c.setRemoteDescription(sdp)
        const answer = await this.c.createAnswer()
        await this.c.setLocalDescription(answer)
        // PeerConnection cannot create an answer in a state other than have-remote-offer or have-local-pranswer.
        const data = {
            event: "answer",
            from: this.me,
            to: this.id,
            data: answer,
        }
        this.$ws.sendJson(data)
    }

    public async onAnswer(sdp: RTCSessionDescription) {
        if (['closed'].includes(this.c.signalingState)) {
            log_warn("onAnswer error signalingState is " + this.c.signalingState)
            return
        }
        await this.c.setRemoteDescription(sdp)
        // 设置后,链接建立完毕
    }

    public async onCandidate(candidate: RTCIceCandidate) {
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
            }
        }

        if (['closed'].includes(this.c.signalingState)) {
            log_warn("onCandidate error signalingState is " + this.c.signalingState)
            return
        }
        this.c.addIceCandidate(candidate)
    }

    // 发送索要请求,上层需要判断是在线了才能调用，60秒内最好不重复发送
    resolve(id: string, parts: Set<fragment>) {
        let data: Array<any> = [];
        if (this.isServer) {
            parts.forEach(item => {
                data.push({ part: item.sn, url: item.url })
            })
        } else {
            parts.forEach(item => {
                data.push(item.sn)
            })
        }
        this.send(JSON.stringify({ event: 'resolve', data: { id, parts: data } }))
        const t = Date.now()
        for (const part of parts) {
            this.queryTasks.push({
                id,
                t,
                sn: part.sn
            })
        }
    }

    send(data: any) {
        if (!this.dc) {
            log_log("data channel to " + this.id + " is not avaiable")
            return
        }
        if (this.dc.readyState !== 'open') {
            log_log("data channel to " + this.id + " is not open")
            return
        }
        try {
            const r = this.dc.send(data)
            if (data instanceof ArrayBuffer) {
                this.tx += data.byteLength
            } else {
                this.tx += data.length
            }
            return r
        } catch (e) {
            log_warn(e)
            // 尝试重新建立连接
            this.connect()
        }

    }

    // 计算最终是否使用了中继
    async isUsedRelay() {
        const stats: any = await this.c.getStats()
        let selectedLocalCandidate: string
        for (const { type, state, localCandidateId } of stats.values())
            if (type === 'candidate-pair' && state === 'succeeded' && localCandidateId) {
                selectedLocalCandidate = localCandidateId
                break
            }
        this.relay = (selectedLocalCandidate && stats.get(selectedLocalCandidate)?.candidateType === 'relay')
        if (this.relay) {
            log_warn("relay found", this)
        }
        return this.relay;
    }

    stat(): peerStat {
        return {
            tx: this.tx,
            rx: this.rx,
            state: this.dc ? this.dc.readyState : null,
            cstate: this.c ? this.c.connectionState : null,
            istate: this.c ? this.c.iceConnectionState : null,
            gstate: this.c ? this.c.iceGatheringState : null,
            bufferedAmount: this.dc ? this.dc.bufferedAmount : 0,
            activetime: this.activetime,
            isServer: this.isServer,
            speed: this.speed,
            hosts: this.hosts,
            localAddress: this.localAddress || localAddress,
            localPort: this.localPort,
            remoteAddress: this.remoteAddress,
            remotePort: this.remotePort,
            relay: this.relay,
            relatedAddress: this.relatedAddress,
            relatedPort: this.relatedPort,
            packet: this.packet,
        }
    }

}

