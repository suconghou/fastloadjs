import { sleep } from './lib/utils/util'
import bufferController from './lib/buffer'
import fastload from "./lib/fastload";
import dispatcher from './lib/dispatcher'
import { streamItem, taskItem } from './lib/types';
import tasks from './lib/tasks/index';
export default class extends fastload {

    private loaders: Array<fastload> = [];

    private mediaSource: MediaSource;

    private video: HTMLMediaElement

    private async get(req: string, id: string, start: number, end: number, mirrors: Array<string>): Promise<ArrayBuffer> {
        const item: taskItem = {
            start,
            end,
            no: 1e9 * (mirrors.length + 1), // only for cache key in tasks.wrap, 此数值使取余算法得到第0位置
            begin: 0, // not used in tasks.wrap
        }
        const retry = 10
        const res = await tasks.wrap(item, id, retry, req, mirrors)()
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
        this.video.removeEventListener('timeupdate', this.timeUpdate)
        this.video.removeEventListener('progress', this.timeUpdate)
        window.URL.revokeObjectURL(this.video.src);
        this.loaders.forEach(item => item.destroy())
        this.loaders = []
        let i = 0;
        while (i++ < 5) {
            if (this.mediaSource.readyState === 'open') {
                const a = []
                for (let item of this.mediaSource.activeSourceBuffers) {
                    a.push(item.updating)
                }
                if (a.every(v => !v)) {
                    return this.mediaSource.endOfStream()
                } else {
                    await sleep(20);
                }
            }
        }
        this.mediaSource = null
    }

    public seekTo(time: number) {
        this.loaders.forEach(item => item.seekTo(time))
    }

}



