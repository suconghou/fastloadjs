// 低级封装
/**
 * ws = new wsJson("ws://xxx")
 * ws.sendJson()
 * ws.listen('message',()=>{})
 * ws.remove('message',fn)
 */
import event from './event';

export class wsJson extends event {
    private $ws: WebSocket | null = null;
    private tasks: Array<string> = [];
    private runing: Boolean = false;
    private timer: any;

    constructor(private addr: string) {
        super();
        if (addr) {
            this.connect();
        }
    }

    // update 仅在下次重新连接时生效
    update(addr: string) {
        this.addr = addr;
        this.connect();
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
            this.trigger('close', ev);
            this.startconnect();
        };
        this.$ws.onerror = (ev: Event) => {
            this.trigger('error', ev);
            this.startconnect();
        };
    }

    private startconnect() {
        clearInterval(this.timer);
        this.timer = setInterval(() => {
            if (window.navigator.onLine === false) {
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
            let item;
            while ((item = this.tasks.shift())) {
                this.$ws.send(item);
            }
        } else {
            this.startconnect();
        }
        this.runing = false;
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

// 默认是一个单例模式的封装
/**
 * 高级封装,主要用于订阅和发布者模式
 *
 * const ws = (ev)=>wsSingle.getWs('ws://xxx',dispath,ev)
 *
 * ws(ev).listen()
 * ws(ev).remove()
 */
export default class wsSingle extends event {
    private static single: wsSingle;
    private static ws: wsJson;
    private static ev: string;
    private static dispatch: Function;

    private constructor(addr: string) {
        super();
        if (!wsSingle.ws) {
            wsSingle.ws = new wsJson(addr);
            wsSingle.ws.listen('open', () => {
                if (wsSingle.ev) {
                    wsSingle.ws.sendJson({ listen: true, event: wsSingle.ev });
                }
            });
            wsSingle.ws.listen('message', (msg: Object) => {
                const { ev, data } = wsSingle.dispatch(msg);
                this.trigger(ev, data);
            });
        }
    }

    public static getWs(addr: string, dispatch: Function, ev: string) {
        if (!this.single) {
            this.ev = ev;
            this.dispatch = dispatch;
            this.single = new this(addr);
        }
        if (addr) {
            wsSingle.ws.update(addr);
        }
        if (ev === '') {
            // 传入空字符串清空订阅
            if (this.ev) {
                this.ws.sendJson({ listen: false, event: this.ev });
            }
            this.ev = ev;
        } else if (!ev) {
            // 传入false,null,undefined不修改订阅
        } else if (ev !== this.ev) {
            if (this.ev) {
                this.ws.sendJson({ listen: false, event: this.ev });
            }
            this.ws.sendJson({ listen: true, event: ev });
            this.ev = ev;
        }
        return this.single;
    }

    public sendJson(data: Object): this {
        wsSingle.ws.sendJson(data);
        return this;
    }
}
