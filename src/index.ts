import { event, sleep, asyncQueue } from './lib/utils/util'
import bufferController from './lib/buffer'
import fastload from "./lib/fastload";
import segments from './media/segments'
export default class extends fastload {

    private loaders: Array<fastload> = [];

    private mediaSource: MediaSource;

    private video: HTMLMediaElement

    private async get(req: string, start: number, end: number, mirrors: Array<string>) {
        const config = {
            req,
            start: Number(start),
            end: Number(end),
            thread: 1,
            thunk: 1024 ** 2,
            meta: req,
            mirrors,
            nop2p: true
        }
        const res = new fastload(config).start(false).getResponse()
        return await res.arrayBuffer()
    }


    async attach(video: HTMLMediaElement, streams: Array<any>) {
        const mediaSource = new MediaSource;

        const sourceOpen = async () => {
            try {
                // console.info('source open')
                const dispatchs = [];
                const initdatas = [];
                const tasks = [];
                const finish = [];
                for (let i = 0; i < streams.length; i++) {
                    const { req, init, index, mimeCodec, len, duration, meta, mirrors } = streams[i]
                    let mediaInfo = { index, len, duration };
                    let webm = /\.webm/.test(req)
                    const [initdata, indexdata] = await Promise.all([this.get(req, init.start, init.end + 1, mirrors), this.get(req, index.start, index.end + 1, mirrors)])
                    initdatas.push([initdata, indexdata])
                    const config = {
                        req,
                        start: 0,
                        end: 0,
                        thread: this.config.thread,
                        meta,
                        mirrors,
                        nop2p: this.config.nop2p
                    }
                    const f = new fastload(config);
                    this.loaders.push(f)
                    f.dispatcher = new segments(indexdata, Number(index.end), Number(mediaInfo.len), webm)
                    const segmentsMap = f.dispatcher.getMap()
                    dispatchs.push(segmentsMap)
                    const reader = f.start(true).getResponse().body.getReader()

                    // 此前是异步,如果频繁切换,可能本实例已被destroy,检测一下
                    if (mediaSource.readyState !== 'open') {
                        return;
                    }
                    const buffer = new bufferController(video, reader, mediaSource, mimeCodec)
                    // 添加一个实例的引用,用于控制cachefill
                    f.refBuffer = buffer
                    tasks.push(() => {
                        f.pause(false)
                        buffer.push(initdata).push(indexdata)
                    })
                    finish.push(buffer.wait())
                    buffer.listen('error', (err) => {
                        // 此处终止,上层需显示错误页面
                        this.trigger('error', err)
                        this.pause()
                    })
                    buffer.listen('pause', () => {
                        // buffer is full
                        f.pause(true)
                    })
                    buffer.listen('start', () => {
                        f.pause(false)
                    })
                }
                this.trigger('ready', this.loaders, dispatchs, initdatas)
                for (let f of tasks) {
                    f();
                }
                await Promise.all(finish)
                // 再有cachefill来回seek的情况下,此时不能endOfStream
                // console.info("endOfStream")
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
    }

    private timeUpdate() {
        if (this.video.buffered.length) {
            const cur = this.video.currentTime;
            for (let i = 0; i < this.video.buffered.length; i++) {
                const start = this.video.buffered.start(i)
                const end = this.video.buffered.end(i)
                if (cur >= start && cur <= end) {
                    // 找到当前播放点所在的缓存端,缓存区不足600秒时,需要开启worker下载数据
                    const cached = end - cur
                    if (cached > 600) {
                        this.pause()
                    } else {
                        this.start()
                    }
                    return
                }
            }
        }
    }

    public start() {
        this.loaders.forEach(item => item.pause(false))
        return this
    }

    public pause() {
        this.loaders.forEach(item => item.pause(true))
        return this;
    }

    public async destroy() {
        this.video.removeEventListener('timeupdate', this.timeUpdate)
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



