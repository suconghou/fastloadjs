import { fragment, config, fetchOpts, partResponse, objectStrMap, mirrorItem, urlItem } from "../../types";
import httpfetch from "../fetcher/httpfetch";
import { globalBuffer } from "../../util/bufferCenter";
import { emit, log_info, log_warn, sleep } from "../../util/util";

export default class {

    private fetchInstance = new httpfetch();

    private mirrors: objectStrMap<number> = {}
    private times: objectStrMap<number> = {}
    private fast2: Array<mirrorItem> = [];
    private fast3: Array<mirrorItem> = [];
    private index = 0;
    private _enable = false;

    private mirrorLoaded: objectStrMap<number> = {};
    private originLoaded: number = 0;


    constructor(private readonly opts: config) {
        if (Array.isArray(opts.mirrors) && opts.mirrors.length) {
            const arr: Array<mirrorItem> = [];
            opts.mirrors.forEach((s) => {
                this.mirrors[s] = 0
                this.times[s] = 0
                arr.push({ url: s, value: 0 })
            })
            this.fast2 = arr.slice(0, 2);
            this.fast3 = arr.slice(0, 3);
            this._enable = true
        }
    }

    private retry(retry: number, urlFn: (() => urlItem), item: fragment): (() => Promise<partResponse>) {
        return async (): Promise<partResponse> => {
            const res: partResponse = { no: item.sn, data: null, err: null, newly: true };
            const buf = globalBuffer.get(this.opts.id, item.sn)
            if (buf) {
                res.data = buf.buffer
                return res
            }
            let url: urlItem;
            const opts: fetchOpts = {
                timeout: 15e3,
                readtimeout: 15e3,
                cache: true,
            };
            let start: number;
            for (let i = 0; i < retry; i++) {
                try {
                    url = urlFn();
                    opts.timeout = url.timeout
                    opts.readtimeout = url.readtimeout
                    start = Date.now();
                    res.data = await this.fetchInstance.fetch(url.url, opts);
                    res.err = null
                    res.newly = true
                    const r = res.data ? res.data.byteLength : -1;
                    if (r <= 0) {
                        throw new Error(`short read error,got ${r}`);
                    }
                    // 下载完成,并且检查没有错误,则中断循环返回
                    globalBuffer.put({ id: this.opts.id, part: item.sn, buffer: res.data })
                    this.stat(url.mirror, this.sok(start), r)
                    break
                } catch (e) {
                    this.stat(url.mirror, -20, 0)
                    // 如果这次下载失败,但是我们检查结果,可能rtc已经成功了,放弃本次http任务
                    const buf = globalBuffer.get(this.opts.id, item.sn)
                    if (buf) {
                        log_info("http error but rtc ok", item)
                        res.err = null;
                        res.data = buf.buffer;
                        res.newly = false
                        return res
                    }
                    opts.cache = false
                    log_warn(e, i, url, item)
                    res.err = e;
                    await sleep(200)
                } finally {
                    emit('mirrors', this.mirrors, this.times, this.mirrorLoaded, this.originLoaded)
                }
            }
            return res;
        }
    }

    // 处理重试，超时，镜像权重，其实上层会处理重试，此处重试2次即可
    async req(item: fragment, s: number): Promise<partResponse> {
        const urlFn = this.getURLFn(item, s)
        const task = this.retry(2, urlFn, item)
        const ret = await task();
        if (ret.err) {
            throw ret.err
        }
        return ret
    }

    getStats() {
        return {
            mirrors: this.mirrors,
            times: this.times,
            mirrorLoaded: this.mirrorLoaded,
            originLoaded: this.originLoaded,
        }
    }

    // 混合两种镜像算法,buffer不足时直接使用源站，buffer10-20秒时，使用权重，超过20s使用取余算法
    private getURLFn(item: fragment, s: number): () => urlItem {
        let i = 0, t1 = Date.now(), ss = s;
        const used: Array<string> = [];
        const mirrors = this.opts.mirrors;
        return (): urlItem => {
            const now = Date.now();
            ss -= (now - t1) / 1e3
            if (ss < 0) {
                ss = 0
            }
            t1 = now;
            log_info('buffered', ss)
            if (ss < 10 || !this.enable) {
                // 当buffer不足时，直接使用源站
                return { url: item.url, mirror: '', timeout: 15e3, readtimeout: 10e3 }
            }
            // 首次使用取余算法,固定的分片序号被分配到固定的镜像上
            let u = mirrors[item.sn % mirrors.length]
            let timeout = 10e3, readtimeout = 8e3;
            if (ss < 15) {
                u = this.best()
            } else if (ss < 20) {
                u = this.rr2()
                timeout = 12e3
                readtimeout = 10e3;
            } else if (ss < 25) {
                u = this.rr3()
                timeout = 14e3
                readtimeout = 12e3
            } else {
                // 否则，就按照取余算法
                timeout = 16e3
                readtimeout = 14e3
            }
            i++
            if (i <= 1) {
                used.push(u)
                return { url: this.buildURL(u, item.url), mirror: u, timeout, readtimeout }
            }
            // 重试时排除之前使用的镜像然后在剩余镜像里随机
            u = this.getBestURL(mirrors, used);
            used.push(u)
            return { url: this.buildURL(u, item.url), mirror: u, timeout, readtimeout }
        }
    }


    // 这个是第二次及以后重试的,排除之前使用的,然后在剩余里随机,如果都使用过,则重新随机
    private getBestURL(mirrors: string[], used: string[]): string {
        const m = mirrors.filter(item => !used.includes(item))
        if (m.length) {
            return m[Math.floor(Math.random() * m.length)]
        }
        used.length = 0
        return mirrors[Math.floor(Math.random() * mirrors.length)]
    }


    get enable() {
        return this._enable && window.TextEncoder
    }

    private best(): string {
        const t = this.init()
        if (t) return t
        return this.fast2[0].url
    }

    private rr2(): string {
        const t = this.init()
        if (t) return t
        const k = this.index++ % this.fast2.length
        return this.fast2[k].url
    }

    private rr3(): string {
        const t = this.init()
        if (t) return t
        const k = this.index++ % this.fast3.length
        return this.fast3[k].url
    }

    private init(): string {
        for (const k of Object.keys(this.mirrors)) {
            if (!this.times[k]) {
                return k
            }
        }
    }

    private stat(s: string, n: number, length: number) {
        if (!s) {
            this.originLoaded += length;
            return
        }
        if (!this.mirrorLoaded[s]) {
            this.mirrorLoaded[s] = length
        } else {
            this.mirrorLoaded[s] += length
        }
        this.times[s]++;
        this.mirrors[s] += n;
        const arr: Array<mirrorItem> = [];
        for (const [k, v] of Object.entries(this.mirrors)) {
            arr.push({ url: k, value: v })
        }
        arr.sort((a, b) => b.value - a.value)
        this.fast2 = arr.slice(0, 2)
        this.fast3 = arr.slice(0, 3)
    }

    private buildURL(mirror: string, u: string) {
        // base64 the origin url
        const key = btoa(Array.from(new TextEncoder().encode(u)).map(x => String.fromCharCode(x)).join(''))
        if (mirror[mirror.length] == '/') {
            return mirror + key
        }
        return mirror + '/' + key
    }

    private sok(start: number): number {
        const t = Date.now() - start;
        let n = 0;
        if (t < 1e3) {
            n = 15
        } else if (t < 2e3) {
            n = 12
        } else if (t < 3e3) {
            n = 8
        } else if (t < 4e3) {
            n = 3
        } else if (t < 5e3) {
            n = 2
        } else if (t < 6e3) {
            n = 1
        }
        return n;
    }


}

