import { sleep } from './util/util'
import bufferController from './buffer'
import fastload from "./fastload";
import dispatcher from './dispatcher'
import taskWrapper from './tasks/index';
import { streamItem, taskItem } from './types';
export default class extends fastload {

    private loaders: Array<fastload> = [];

    private mediaSource: MediaSource;

    private video: HTMLMediaElement

    // attach时登记的清理函数,destroy时统一执行
    private detachFns: Array<Function> = [];

    private async get(req: string, id: string, start: number, end: number, mirrors: Array<string>): Promise<ArrayBuffer> {
        const item: taskItem = {
            start,
            end,
            no: 1e9 * (mirrors.length + 1), // only for cache key in tasks.wrap, 此数值使取余算法得到第0位置
            begin: 0, // not used in tasks.wrap
        }
        const retry = 10
        const res = await taskWrapper.wrap(item, id, retry, req, mirrors)()
        if (res.err) {
            throw res.err
        }
        return res.data
    }

    async attach(video: HTMLMediaElement, streams: Array<streamItem>) {
        const mediaSource = new MediaSource;

        const sourceOpen = async () => {
            try {
                const dispatchs = [];
                const tasks = [];
                for (let i = 0; i < streams.length; i++) {
                    const { req, init, index, mimeCodec, len, meta, mirrors } = streams[i]
                    const [initdata, indexdata] = await Promise.all([this.get(req, meta, init.start, init.end + 1, mirrors || []), this.get(req, meta, index.start, index.end + 1, mirrors || [])])
                    const config = {
                        req,
                        thread: this.config.thread,
                        retry: this.config.retry,
                        meta,
                        mirrors: mirrors || [],
                        wsize: this.config.wsize,
                        tracker: this.config.tracker,
                        rtcConf: this.config.rtcConf,
                    }
                    const f = new fastload(config);
                    this.loaders.push(f)
                    const disp = new dispatcher(indexdata, Number(index.end), Number(len), /\.webm/.test(req))
                    const segmentsMap = disp.getMap()
                    dispatchs.push(segmentsMap)

                    // 此前是异步,如果频繁切换,可能本实例已被destroy,检测一下
                    if (mediaSource.readyState !== 'open') {
                        return;
                    }
                    const buffer = new bufferController(video, mediaSource, mimeCodec)
                    f.init(buffer, disp)

                    // 添加一个实例的引用,用于控制cachefill
                    tasks.push(() => {
                        f.start()
                        buffer.push(initdata).push(indexdata)
                    })
                    buffer.listen('error', (err) => {
                        // 此处终止,上层需显示错误页面
                        this.trigger('error', err)
                        this.pause()
                    })
                }
                this.trigger('ready', this.loaders, dispatchs)
                for (let f of tasks) {
                    f();
                }
            } catch (e) {
                this.trigger('error', e)
                this.pause()
            }
        }
        const sourceClosed = (e: Event) => {
            // console.warn("closed", e)
        }
        const sourceEnded = (e: Event) => {
            // console.warn("end", e)
        }
        mediaSource.addEventListener('sourceopen', sourceOpen);
        mediaSource.addEventListener('sourceclosed', sourceClosed);
        mediaSource.addEventListener('sourceended', sourceEnded)
        this.video = video
        this.mediaSource = mediaSource
        video.src = URL.createObjectURL(mediaSource);
        this.timeUpdate = this.timeUpdate.bind(this)
        video.addEventListener('timeupdate', this.timeUpdate)
        video.addEventListener('progress', this.timeUpdate)
        this.detachFns.push(() => {
            mediaSource.removeEventListener('sourceopen', sourceOpen)
            mediaSource.removeEventListener('sourceclosed', sourceClosed)
            mediaSource.removeEventListener('sourceended', sourceEnded)
        }, () => {
            video.removeEventListener('timeupdate', this.timeUpdate)
            video.removeEventListener('progress', this.timeUpdate)
        })
    }

    private timeUpdate() {
        if (this.video.buffered.length) {
            const cur = this.video.currentTime;
            for (let i = 0; i < this.video.buffered.length; i++) {
                const start = this.video.buffered.start(i)
                const end = this.video.buffered.end(i)
                if (cur >= start && cur <= end) {
                    // 找到当前播放点所在的缓存端,缓存区不足300秒时,需要开启worker下载数据
                    const cached = end - cur
                    if (cached > 3) {
                        this.pause()
                    } else {
                        this.start()
                    }
                    this.setBufferHealth(cached)
                    return
                }
            }
        }
    }

    public start() {
        this.loaders.forEach(item => item.start())
        return this
    }

    public pause() {
        this.loaders.forEach(item => item.pause())
        return this;
    }

    public setBufferHealth(t: number) {
        this.loaders.forEach(item => item.setBufferHealth(t))
        return this;
    }

    public async destroy() {
        this.pause()
        for (let fn of this.detachFns) {
            fn()
        }
        this.detachFns = []
        this.loaders.forEach(item => item.destroy())
        this.loaders = []
        if (this.video && this.video.src) {
            window.URL.revokeObjectURL(this.video.src);
        }
        const ms = this.mediaSource
        this.mediaSource = null
        if (!ms) {
            return
        }
        // 等待sourceBuffer写入结束再endOfStream,最多约2.5s,避免静默失败
        let i = 0;
        while (i++ < 50) {
            if (ms.readyState !== 'open') {
                return
            }
            const updating = [];
            for (let item of ms.activeSourceBuffers) {
                updating.push(item.updating)
            }
            if (updating.every(v => !v)) {
                try {
                    ms.endOfStream()
                } catch (e) {
                    console.error(e)
                }
                return
            }
            await sleep(50);
        }
    }

    public seekTo(time: number) {
        this.loaders.forEach(item => item.seekTo(time))
    }

}



