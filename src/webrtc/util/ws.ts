
import event from './event';

export default class extends event {
    private $ws: WebSocket | null = null;
    private tasks: Array<string> = [];
    private runing: Boolean = false;
    private timer: any;

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
        clearInterval(this.timer);
        this.timer = setInterval(() => {
            if (navigator.onLine === false) {
                return;
            }
            this.connect();
        }, 2000);
    }

    private stopconnect() {
        clearInterval(this.timer);
    }

    private notify() {
        if (this.runing) {
            return;
        }
        this.runing = true;
        if (this.$ws && this.$ws.readyState == this.$ws.OPEN) {
            let item: any;
            while ((item = this.tasks.shift())) {
                this.$ws.send(item);
            }
        } else {
            this.startconnect();
        }
        this.runing = false;
    }

    // raw ws send
    public send(data: string | ArrayBufferLike | Blob | ArrayBufferView): this {
        this.$ws.send(data)
        return this;
    }

    public sendJson(data: Object): this {
        try {
            const str = JSON.stringify(data);
            if (str) {
                this.tasks.push(str);
                this.notify();
            }
        } catch (e) {
            console.error(e);
        }
        return this;
    }
}
