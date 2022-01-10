import { ws, uuid, warn, info, log } from './util/util'

export default class {

    private c: RTCPeerConnection

    private dc: RTCDataChannel;

    private tx: number = 0

    private rx: number = 0

    private restart: number = 0

    constructor(public readonly id: string, private readonly servers: RTCConfiguration, private readonly onmsg: (type: string, e: Object) => void) {
        this.init();
    }

    private init() {
        if (this.c) {
            try {
                this.c.close()
            } catch (e) {
                log(e)
            }
        }
        this.c = new RTCPeerConnection(this.servers);
        this.c.onnegotiationneeded = async (ev: Event) => {
            log(ev)
            try {
                const offer = await this.c.createOffer();
                await this.c.setLocalDescription(offer)
                // send sdp to ws server
                ws().sendJson({ event: 'offer', to: this.id, from: uuid(), data: offer })
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
                    from: uuid(),
                    to: this.id,
                    data: ev.candidate
                }
                ws().sendJson(data)
                log("send candidate", data)
            }
        }
    }

    public waitForConnect() {
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
            this.dcInit()
        }
        if (this.c && this.c.connectionState == 'connected' && this.dc && this.dc.readyState == 'open') {
            info("connection to ", this.id, " is already open")
            // 对方刷新时,我方执行此逻辑;这个到底是不是链接着的,我们再发送一个ping探测一下
            this.send(JSON.stringify({ event: 'ping' }))
            clearTimeout(this.restart)
            this.restart = setTimeout(() => connect(), 5e3)
            return
        }
        connect();
    }

    private dcInit() {
        window.addEventListener('beforeunload', () => {
            this.c.close()
            this.dc.close()
        })
        this.dc.onopen = (e) => {
            warn("dc open me : " + uuid() + " remote: " + this.id, e)
            this.onmsg('open', e);
        }
        this.dc.onclose = e => {
            warn("dc close " + this.id, e)
            this.onmsg('close', e);
        }
        this.dc.onerror = e => {
            warn("dc error " + this.id, e)
            this.onmsg('error', e);
        }
        this.dc.addEventListener('closing', (e) => {
            warn("dc closing " + this.id, e)
            this.onmsg('closing', e);
        })
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
            this.onmsg('message', { data })
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
            from: uuid(),
            to: this.id,
            data: answer,
        }
        log("send answer", data)
        ws().sendJson(data)
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

    stat() {
        return {
            tx: this.tx,
            rx: this.rx,
            state: this.dc ? this.dc.readyState : '',
            cstate: this.c ? this.c.connectionState : '',
            istate: this.c ? this.c.iceConnectionState : '',
            gstate: this.c ? this.c.iceGatheringState : '',
        }
    }
}

