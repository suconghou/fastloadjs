import { bufferItem, config, fragment, httpTask, partResponse, rtcBufferItem, rtcProgressInfo, rtcReqRet, rtcTask, videoDownloadStat, } from '../../types';
import event from '../../util/event';
import { globalBuffer } from '../../util/bufferCenter'
import rtcProvider from './rtcProvider';
import httpProvider from './httpProvider';
import { emit, sleep } from '../../util/util';


export default class extends event {

    private httpTotalDownload: number = 0;
    private rtcClientDownload: number = 0;
    private rtcServerDownload: number = 0;
    private rtcClientDelayDownload: number = 0;
    private rtcServerDelayDownload: number = 0;
    private rtcTotalDownload: number = 0;
    private rtcProvider: rtcProvider;
    private httpProvider: httpProvider;
    private tasks: Map<number, Promise<bufferItem>> = new Map();
    private httpThread: number = 0;

    private lastReportTime: number = 0;

    constructor(private readonly opts: config, private readonly swarmId: string) {
        super()
        if (opts.statURL) {
            window.addEventListener('beforeunload', () => {
                const httpData = this.httpProvider.getStats()
                const statData = this.getStatData()
                const body = JSON.stringify({ id: opts.id, url: opts.url, href: window.location.href, httpData, statData })
                if (navigator.sendBeacon) {
                    navigator.sendBeacon(opts.statURL, body)
                } else {
                    fetch(opts.statURL, { method: 'POST', body })
                }
            })
        }

    }

    async req(item: fragment, s: number): Promise<bufferItem> {
        const buf = globalBuffer.get(this.swarmId, item.sn)
        if (buf) {
            return buf
        }
        let t = this.tasks.get(item.sn)
        try {
            if (!t) {
                t = new Promise(async (resolve, reject) => {
                    try {
                        // 此处rtc和http都要发起请求，rtc请求可能之前已经预期了，会自动过滤
                        this.rtcReq([item], 1)
                        const r = await Promise.race(this.buildReq(item, s))
                        return resolve(r)
                    } catch (e) {
                        return reject(e)
                    }
                })
                this.tasks.set(item.sn, t)
            }
            return await t
        } finally {
            this.tasks.delete(item.sn)
        }
    }

    private buildReq(item: fragment, s: number): Array<Promise<bufferItem>> {
        const p1: Promise<bufferItem> = new Promise(async (resolve) => {
            while (true) {
                await sleep(200)
                const buf = globalBuffer.get(this.swarmId, item.sn)
                if (buf) {
                    return resolve(buf)
                }
            }
        })
        return [p1, this.httpReq(item, s)]
    }

    // 对后续的fragment预加载，对每一个fragment建立一个Promise任务
    // 后续判断如果已在执行了，则忽略
    next(rtasks: Array<fragment>, cachedNum: number, s: number) {
        const parts = rtasks.slice(0, (cachedNum < 10 ? 5 : 2) + Math.round(Math.random() * 10));
        const ret = this.rtcReq(parts, cachedNum)
        // 返回的 unresolved 仍然是有序的
        // 如果有镜像可用，在15-20秒之间，可以允许发送一个；低于15s,则按照线程数约定，高于20s如果有rtc则忽略,没有rtc但有镜像可以允许1个
        // 没有镜像可用时，则一直按照低于15s才开启多线程
        // 如果rtc完全无效，并且我们有镜像，可以允许小于25时发送一个
        const l = Array.isArray(this.opts.mirrors) ? this.opts.mirrors.length : 0;
        const nortc = ret.unresolved.length >= parts.length
        // 1. 小于15s.
        // 2. 有镜像时，<20 时
        // 3. 没rtc但是有镜像，<25时
        const need = s < 15 || (l > 0 && s < 20) || (nortc && l > 0 && s < 25);
        if (!need) {
            return
        }
        const prefetch = s > 15 && l > 0;
        for (const item of ret.unresolved) {
            if (this.httpThread >= this.opts.maxHttpThread) {
                return
            }
            let t = this.tasks.get(item.sn)
            if (!t) {
                t = new Promise(async (resolve, reject) => {
                    try {
                        this.httpThread++
                        // 此处仅发送http请求，同时检测rtc和http的响应
                        const r = await Promise.race(this.buildReq(item, s))
                        return resolve(r)
                    } catch (e) {
                        return reject(e)
                    } finally {
                        this.httpThread--
                    }
                })
                this.tasks.set(item.sn, t)
                if (prefetch) {
                    return
                }
            }

        }

        if (s > 5) {
            // 仅在buffer不足时启用guessed，http补偿
            return
        }

        for (const item of ret.guessed) {
            if (this.httpThread >= this.opts.maxHttpThread) {
                return
            }
            let t = this.tasks.get(item.sn)
            if (!t) {
                t = new Promise(async (resolve, reject) => {
                    try {
                        this.httpThread++
                        // 此处仅发送http请求，同时检测rtc和http的响应
                        const r = await Promise.race(this.buildReq(item, s))
                        return resolve(r)
                    } catch (e) {
                        return reject(e)
                    } finally {
                        this.httpThread--
                    }
                })
                this.tasks.set(item.sn, t)
            }
        }
    }


    private rtcReq(missing: Array<fragment>, cachedNum: number): rtcReqRet {
        if (!this.rtcProvider) {
            this.rtcProvider = new rtcProvider(this.opts)
            this.rtcProvider.listen('buffer', (item: rtcBufferItem) => {
                // newly 可以识别是否是rtc先返回的
                const n = item.data.buffer.byteLength
                if (item.newly) {
                    if (item.server) {
                        this.rtcServerDownload += n;
                    } else {
                        this.rtcClientDownload += n;
                    }
                } else {
                    if (item.server) {
                        this.rtcServerDelayDownload += n;
                    } else {
                        this.rtcClientDelayDownload += n;
                    }
                }
                emit('rtc-buffer', item)
            }).listen('buffer.recv', (item: rtcProgressInfo) => {
                this.rtcTotalDownload += item.data.data.byteLength
                this.vstat();
                emit('buffer.recv', item)
            })
        }
        const ret = this.rtcProvider.req(this.swarmId, missing, cachedNum);
        const unresolved_sn = ret.unresolved.map(item => item.sn);
        const guessed_sn = ret.guessed.map(item => item.sn);
        const resolved = missing.filter(item => !unresolved_sn.includes(item.sn) && !guessed_sn.includes(item.sn))

        resolved.length && emit('rtc-start', { id: this.swarmId, data: resolved } as rtcTask)
        ret.guessed.length && emit('rtc-guess', { id: this.swarmId, data: ret.guessed } as rtcTask)
        return ret
    }

    private async httpReq(part: fragment, s: number): Promise<bufferItem> {
        if (!this.httpProvider) {
            this.httpProvider = new httpProvider(this.opts)
        }
        emit('http-start', { id: this.swarmId, data: part } as httpTask)
        const resItem: partResponse = await this.httpProvider.req(part, s)
        if (resItem.newly) {
            this.httpTotalDownload += resItem.data.byteLength
        }
        const res: bufferItem = { id: this.swarmId, part: resItem.no, buffer: resItem.data }
        // 也有可能是失败重试时，rtc已经获取到了，rtc返回的
        this.vstat();
        emit('http-buffer', res)
        return res
    }

    private vstat() {
        const now = Date.now()
        if (now - this.lastReportTime > 2e3) {
            this.lastReportTime = now
            emit('vstat', this.getStatData())
        }
    }

    private getStatData(): videoDownloadStat {
        const stat: videoDownloadStat = {
            httpTotalDownload: this.httpTotalDownload,
            rtcClientDownload: this.rtcClientDownload,
            rtcServerDownload: this.rtcServerDownload,
            rtcClientDelayDownload: this.rtcClientDelayDownload,
            rtcServerDelayDownload: this.rtcServerDelayDownload,
            rtcTotalDownload: this.rtcTotalDownload,
        }
        return stat
    }

    rtcPeers() {
        if (this.rtcProvider) {
            return this.rtcProvider.getPeers()
        }
    }

    rtcStats() {
        if (this.rtcProvider) {
            return this.rtcProvider.getStats()
        }
    }

}

