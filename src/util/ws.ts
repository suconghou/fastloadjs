
import event from './event';

// 离线消息队列上限与时效
const maxQueue = 500;
const queueTtl = 60e3;

export default class extends event {
    private $ws: WebSocket | null = null;
    private tasks: Array<{ t: number, str: string }> = [];
    private runing: Boolean = false;
    private timer: any;
    private delay: number = 2e3;

    constructor(private addr: string) {
        super();
        this.connect();
    }

    destroy() {
        this.stopconnect();
        this.connect = () => { }
        this.startconnect = () => { }
        this.notify = () => { }
        this.sendJson = (data: Object) => { console.error("closed"); return this }
        if (this.$ws) {
            this.$ws.close();
        }
    }

    private connect() {
        if (this.$ws && (this.$ws.readyState == this.$ws.OPEN || this.$ws.readyState == this.$ws.CONNECTING)) {
            this.stopconnect();
            return;
        }
        this.$ws = new WebSocket(this.addr);
        this.$ws.binaryType = 'arraybuffer';
        this.$ws.onopen = (ev: Event) => {
            this.trigger('open', ev);
            // 连接成功,重置退避间隔
            this.delay = 2e3;
            this.stopconnect();
            this.notify();
        };
        this.$ws.onmessage = (ev: MessageEvent) => {
            this.trigger('message', ev);
        };
        this.$ws.onclose = (ev: CloseEvent) => {
            console.log(ev, ev.reason, ev.toString())
            this.trigger('close', ev);
            this.startconnect();
        };
        this.$ws.onerror = (ev: Event) => {
            console.warn(ev, ev.toString())
            this.trigger('error', ev);
            this.startconnect();
        };
    }

    private startconnect() {
        if (this.timer) {
            // 已有重连定时器在跑,避免每次sendJson都重置间隔导致退避混乱
            return;
        }
        // 指数退避:2s起步,每次翻倍,30s封顶,连接成功后重置
        const d = this.delay;
        this.delay = Math.min(30e3, this.delay * 2);
        this.timer = setInterval(() => {
            if (navigator.onLine === false) {
                return;
            }
            this.connect();
        }, d);
    }

    private stopconnect() {
        clearInterval(this.timer);
        this.timer = null;
    }

    private notify() {
        if (this.runing) {
            return;
        }
        this.runing = true;
        if (this.$ws && this.$ws.readyState == this.$ws.OPEN) {
            const now = Date.now();
            let item: { t: number, str: string } | undefined;
            while ((item = this.tasks.shift())) {
                if (now - item.t > queueTtl) {
                    // 离线期间积压的旧信令(offer/answer/candidate)已失效,丢弃,避免重连后引发对端wrong state
                    continue;
                }
                this.$ws.send(item.str);
            }
        } else {
            this.startconnect();
        }
        this.runing = false;
    }

    // raw ws send
    public send(data: string | ArrayBufferLike | Blob | ArrayBufferView): this {
        this.$ws && this.$ws.send(data as string | Blob | BufferSource)
        return this;
    }

    public sendJson(data: Object): this {
        try {
            const str = JSON.stringify(data);
            if (str) {
                // 限制离线队列长度,超出时丢弃最旧的
                while (this.tasks.length >= maxQueue) {
                    this.tasks.shift()
                }
                this.tasks.push({ t: Date.now(), str });
                this.notify();
            }
        } catch (e) {
            console.error(e);
        }
        return this;
    }
}
