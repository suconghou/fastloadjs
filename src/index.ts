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
            // no 此处仅用于镜像取余,取 0 恒落源站。init/index 不写 globalBuffer:
            // 两者若共用一个 no,重复 attach(同 meta,600s 内)时 init 会命中 index 的缓存拿到对方的字节;
            // 且这两个 payload 会被 hosts() 当作"已持有的分片"广播给 peer
            no: 0,
            begin: 0, // not used in tasks.wrap
        }
        // init/index是播放器启动的关键请求,重试次数不宜过高:内部每次重试timeout递增(15s起),10次可阻塞播放器近7分钟
        const retry = 3
        const res = await taskWrapper.wrap(item, id, retry, req, mirrors, false)()
        if (res.err) {
            throw res.err
        }
        return res.data
    }

    async attach(video: HTMLMediaElement, streams: Array<streamItem>) {
        // 重复attach(如切换播放源)时,旧实例的worker/rtc/buffer若不销毁,旧buffer会因mediaSource已关闭而无限空转
        // keepListen:此处必须保留调用方注册的监听器,否则切换播放源后 error/ready 监听会静默失效,后续错误将被吞掉
        if (this.loaders.length) {
            await this.destroy(true)
        }
        const mediaSource = new MediaSource;

        const sourceOpen = async () => {
            try {
                const dispatchs = [];
                const tasks = [];
                for (let i = 0; i < streams.length; i++) {
                    const { req, init, index, mimeCodec, len, meta, mirrors } = streams[i]
                    // 分块 URL 依赖扩展名改写(见 README"关于 URL 改写"),源地址必须在路径末段以 .mp4/.webm 结尾。
                    // 在此提前拦下,否则每个分片都会先白拉一次整文件,直到 short read 校验才失败
                    if (!/\.(mp4|webm)([?#]|$)/.test(req)) {
                        throw new Error(`unsupported stream url:${req} (需以 .mp4/.webm 结尾)`)
                    }
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
                    // 内层 loader 永久失败只会停摆,需冒泡到外层,否则播放界面一直 loading
                    f.listen('error', (e: unknown) => {
                        this.trigger('error', e)
                        this.pause()
                    })
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
        this.onWaiting = this.onWaiting.bind(this)
        video.addEventListener('timeupdate', this.timeUpdate)
        video.addEventListener('progress', this.timeUpdate)
        // 缓冲耗尽时currentTime不再推进,timeupdate停发,worker若处于pause会永久卡死,此处兜底恢复
        video.addEventListener('waiting', this.onWaiting)
        this.detachFns.push(() => {
            mediaSource.removeEventListener('sourceopen', sourceOpen)
            mediaSource.removeEventListener('sourceclosed', sourceClosed)
            mediaSource.removeEventListener('sourceended', sourceEnded)
        }, () => {
            video.removeEventListener('timeupdate', this.timeUpdate)
            video.removeEventListener('progress', this.timeUpdate)
            video.removeEventListener('waiting', this.onWaiting)
        })
    }

    // 缓冲低水位(秒):低于此值才恢复下载。过低会导致每轮窗口下完后一直等到缓冲耗尽才续期,
    // 网络抖动时直接卡顿;过高则浪费带宽。一轮窗口约 wsize 个分片,典型 40-80 秒
    private lowWater = 60

    // 卡顿期间的定时复查句柄,播放恢复后由 disarmStall 撤销
    private stallTimer: any = null
    private disarmStall: Function = null

    private timeUpdate() {
        if (this.video.buffered.length) {
            const cur = this.video.currentTime;
            for (let i = 0; i < this.video.buffered.length; i++) {
                const start = this.video.buffered.start(i)
                const end = this.video.buffered.end(i)
                if (cur >= start && cur <= end) {
                    // 找到当前播放点所在的缓存端,缓冲不足低水位时,需要开启worker下载数据
                    const cached = end - cur
                    if (cached > this.lowWater) {
                        this.pause()
                    } else {
                        this.start()
                    }
                    this.setBufferHealth(cached)
                    return
                }
                if (cur < start) {
                    // 播放点落在所有缓冲区之前(如回退到已被清理的位置),缓冲区对当前播放不可用,按无缓存处理
                    break
                }
            }
            // 越过最后一个缓冲区的末尾,同样需要继续下载
            this.start()
            this.setBufferHealth(0)
        }
    }

    // 视频因缓冲不足而停顿时,立即恢复下载,避免pause状态下事件停发导致的死锁
    private onWaiting() {
        this.start()
        this.armStallCheck()
        if (this.video.buffered.length) {
            const cur = this.video.currentTime
            for (let i = 0; i < this.video.buffered.length; i++) {
                if (cur >= this.video.buffered.start(i) && cur <= this.video.buffered.end(i)) {
                    this.setBufferHealth(this.video.buffered.end(i) - cur)
                    return
                }
            }
        }
        this.setBufferHealth(0)
    }

    // 卡顿期间currentTime停滞,timeupdate/progress停发,timeUpdate里的pause分支永远走不到,
    // 下载会一直进行到整个窗口分片下完为止。此处开启定时复查,主动执行缓冲管理,
    // 缓冲超过低水位即暂停;一旦播放恢复(playing/seeked)立即撤销,回到纯事件驱动
    private armStallCheck() {
        if (this.stallTimer) {
            return
        }
        const disarm = () => {
            this.video.removeEventListener('playing', disarm)
            this.video.removeEventListener('seeked', disarm)
            clearInterval(this.stallTimer)
            this.stallTimer = null
            this.disarmStall = null
        }
        this.disarmStall = disarm
        this.video.addEventListener('playing', disarm)
        this.video.addEventListener('seeked', disarm)
        this.stallTimer = setInterval(() => this.timeUpdate(), 1000)
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

    // keepListen: 保留监听器(attach 内部重建时使用),默认 false 会连带清空调用方注册的事件
    public async destroy(keepListen: boolean = false) {
        this.pause()
        if (this.disarmStall) {
            this.disarmStall()
        }
        for (let fn of this.detachFns) {
            fn()
        }
        this.detachFns = []
        this.loaders.forEach(item => item.destroy())
        this.loaders = []
        // 顶层实例自身也持有rtc引用计数,必须经super.destroy()走rtcReset释放,否则共享的rtc实例永不销毁
        super.destroy(keepListen)
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



