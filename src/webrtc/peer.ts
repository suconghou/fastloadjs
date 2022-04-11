import { bufferItem, fastConfig, hostsMap, peerStat, resolveTask, rtcRecv } from '../lib/types';
import { globalBuffer } from '../lib/utils/bufferCenter';
import { info, log, warn } from '../lib/utils/util';
import { uuid, decode, concatArrayBuffers, singal, encode, isServer } from './util/util'
import ws from './util/ws';

const rtcMax = 64 * 1024

export default class {

    private c: RTCPeerConnection
    private dc: RTCDataChannel;
    private tx: number = 0
    private rx: number = 0
    private restart: number = 0
    private activetime: number = 0
    private isServer: boolean


    // 缓存分包的rtc数据，收到完整的一个包后清理缓存
    private buffers: Map<string, Array<ArrayBuffer>> = new Map()


    // 对端图解
    private hosts: hostsMap = {}
    private selfHosts: string
    private hostsTimer: number;

    // 任务定时器，轮询60内的任务，
    private resolveTasks: Array<resolveTask> = [];
    private resolveTaskTimer: number;
    // 我们的请求任务，如果发现我们已经有了，也自动发送quit
    private queryTasks: Array<resolveTask> = [];

    private $ws: ws;
    private me = uuid();

    // trigger open/close/error/message
    constructor(public readonly id: string, private readonly opts: fastConfig, private readonly trigger: (type: string, data: Object) => void) {
        this.isServer = isServer(id)
        this.$ws = singal(opts.tracker)
        this.init();
        this.resolveTaskTimer = setInterval(() => this.doTask(), 2e3);
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
                log(e)
            }
        }
        this.c = new RTCPeerConnection(this.opts.rtcConf);
        this.c.onnegotiationneeded = async (ev: Event) => {
            log(ev)
            try {
                const offer = await this.c.createOffer();
                await this.c.setLocalDescription(offer)
                // send sdp to ws server
                this.$ws.sendJson({ event: 'offer', to: this.id, from: this.me, data: offer })
                log(offer)
            } catch (e) {
                warn(e)
            }
        }

        this.c.ondatachannel = (ev: RTCDataChannelEvent) => {
            // 对方建立了 datachannel, 我方收到就维护起来
            if (this.dc) {
                try {
                    this.dc.close()
                } catch (e) {
                    log(e)
                }
            }
            this.dc = ev.channel
            this.dc.binaryType = 'arraybuffer'
            this.dc.bufferedAmountLowThreshold = 65536
            this.dcInit()
            log(ev)
        }
        this.c.onconnectionstatechange = (ev: Event) => {
            log(ev)
        }
        this.c.onicecandidateerror = (ev: Event) => {
            warn(ev)
        }

        this.c.onicegatheringstatechange = (ev: Event) => {
            log(ev)
        }

        this.c.oniceconnectionstatechange = (ev: Event) => {
            log(ev)
        }

        this.c.onicecandidate = (ev) => {
            log(ev)
            if (ev.candidate) {
                const data = {
                    event: 'candidate',
                    from: this.me,
                    to: this.id,
                    data: ev.candidate
                }
                this.$ws.sendJson(data)
                log("send candidate", data)
            }
        }
    }

    public waitForConnect() {
    }

    private doTask() {
        const t = Date.now();
        this.resolveTasks = this.resolveTasks.filter((item) => {
            // 如果查找到了，则回复给他，然后清理这个任务
            const buf = globalBuffer.get(item.id, item.sn)
            if (buf && this.cansend) {
                this.sendBuffer(buf);
                return false
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
    }

    // 我主动链接这个ID
    async connect() {
        log("i connect ", this.id)
        const connect = () => {
            this.init()
            if (this.dc) {
                try {
                    this.dc.close()
                } catch (e) {
                    log(e)
                }
            }
            this.dc = this.c.createDataChannel("dc", { maxPacketLifeTime: 2000 })
            this.dc.binaryType = 'arraybuffer'
            this.dc.bufferedAmountLowThreshold = 65536;
            this.dcInit()
        }
        if (this.c && this.c.connectionState == 'connected' && this.cansend) {
            info("connection to ", this.id, " is already open")
            // 对方刷新时,我方执行此逻辑;这个到底是不是链接着的,我们再发送一个ping探测一下
            this.send(JSON.stringify({ event: 'ping' }))
            clearTimeout(this.restart)
            this.restart = setTimeout(() => connect(), 5e3)
            return
        }
        connect();
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
            this.activetime = Date.now()
            warn("dc open me : " + this.me + " remote: " + this.id, e)
            this.trigger('open', { id: this.id, data: e });
            this.sendHosts(true)
            clearInterval(this.hostsTimer)
            this.hostsTimer = setInterval(() => this.sendHosts(), 15e3)
        }
        this.dc.onclose = e => {
            warn("dc close " + this.id, e)
            this.trigger('close', { id: this.id, data: e });
        }
        this.dc.onerror = e => {
            warn("dc error " + this.id, e)
            this.trigger('error', { id: this.id, data: e });
        }
        this.dc.onbufferedamountlow = () => {
            // 如果我们有发送任务，在此处发送
        }
        this.dc.onmessage = async (e) => {
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

    // TODO trigger message/buffer/buffer.recv
    private extract(data: ArrayBuffer) {
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
                            const item = globalBuffer.get(id, sn)
                            if (!item) {
                                // 当前我们没有这个buffer,我们就将它加入到任务队列，在60s内如果我们拥有了，则会发送给他，如果太久则自动放弃
                                this.resolveTasks.push({
                                    id,
                                    t,
                                    sn,
                                })
                                continue
                            }
                            this.sendBuffer(item)
                        }
                    }
                    return
                case 'quit':
                    {
                        const id: string = info.data.id;
                        const parts: Array<number> = info.data.parts
                        // 对方之前索要过，但是现在要放弃，必然是对方60s内发送过索要请求，如果对方发送索要请求超过60s,则对方无需发送quit
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
        const item = this.buffers.get(info.id)
        if (item) {
            item[info.i] = info.data
        } else {
            const b: Array<ArrayBuffer> = [];
            b[info.i] = info.data
            this.buffers.set(info.id, b)
        }
        // 我们发出的请求得到回应了，我们清理这个进行中的队列
        this.queryTasks = this.queryTasks.filter((it) => {
            if (it.id == info.id && it.sn == info.sn) {
                return false
            }
            return true
        })
        // 分片传输中,可用于进度提示
        this.trigger('buffer.recv', { data: info, id: this.id })
        let done = true;
        const c = this.buffers.get(info.id)
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
        let buffers: ArrayBuffer = c[0]
        for (let j = 1; j < info.n; j++) {
            buffers = concatArrayBuffers(buffers, c[j])
        }
        this.buffers.delete(info.id)
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
        this.trigger('buffer', { data: partItem, newly, id: this.id })
        if (!newly) {
            console.info('already have buffer', partItem)
        }
    }

    // TODO may check conection status
    private sendBuffer(data: bufferItem) {
        const datas = this.splitBuffer(data)
        for (let i = 0; i < datas.length; i++) {
            const item = datas[i]
            this.send(item)
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

    public async onOffer(sdp: RTCSessionDescription) {
        if (this.c.signalingState == 'closed') {
            warn("onOffer error signalingState is closed");
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
        log("send answer", data)
        this.$ws.sendJson(data)
    }



    public async onAnswer(sdp: RTCSessionDescription) {
        if (['closed'].includes(this.c.signalingState)) {
            warn("onAnswer error signalingState is " + this.c.signalingState)
            return
        }
        await this.c.setRemoteDescription(sdp)
        info('setRemoteDescription', sdp)
        // 设置后,链接建立完毕
    }

    public async onCandidate(candidate: RTCIceCandidate) {
        if (['closed'].includes(this.c.signalingState)) {
            warn("onCandidate error signalingState is " + this.c.signalingState)
            return
        }
        this.c.addIceCandidate(candidate)
        log("made connection ", this.id)
    }


    // 发送索要请求
    resolve(id: string, parts: Array<number>) {
        const data = JSON.stringify({ event: 'resolve', data: { id, parts } })
        this.send(data)
        const t = Date.now()
        for (const sn of parts) {
            this.queryTasks.push({
                id,
                t,
                sn
            })
        }
    }

    // TODO improve this
    send(data: any) {
        if (!this.dc) {
            log("data channel to " + this.id + " is not avaiable")
            return
        }
        if (this.dc.readyState !== 'open') {
            log("data channel to " + this.id + " is not open")
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
            warn(e)
            // 尝试重新建立连接
            this.connect()
        }

    }

    stat(): peerStat {
        return {
            tx: this.tx,
            rx: this.rx,
            state: this.dc ? this.dc.readyState : null,
            cstate: this.c ? this.c.connectionState : null,
            istate: this.c ? this.c.iceConnectionState : null,
            gstate: this.c ? this.c.iceGatheringState : null,
            activetime: this.activetime,
            isServer: this.isServer,
            hosts: this.hosts,
        }
    }
}

