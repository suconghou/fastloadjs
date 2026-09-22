import { sleep, asyncQueue } from './util/util'
import event from './util/event';
// 共计抛出事件  pause / error
// error 被顶级处理， pause 被所属fastloader处理
export default class extends event {

    private sourceBuffer: SourceBuffer

    private q = new asyncQueue([])

    private destroyed: boolean = false;

    constructor(private video: HTMLMediaElement, private mediaSource: MediaSource, mimeCodec: string) {
        super()
        const sourceBuffer = mediaSource.addSourceBuffer(mimeCodec)
        sourceBuffer.addEventListener('abort', console.info)
        sourceBuffer.addEventListener('error', console.error)
        this.sourceBuffer = sourceBuffer;
    }

    destroy() {
        this.q.clear()
        this.destroyed = true
    }

    clear() {
        this.q.clear()
    }

    push(data: ArrayBuffer): this {
        this.q.push(() => {
            return new Promise<void>(async (resolve, reject) => {
                while (true) {
                    try {
                        if (this.destroyed) {
                            // 调用了destroy,则全部任务取消
                            return resolve()
                        }
                        if (this.mediaSource.readyState === 'open' && !this.sourceBuffer.updating) {
                            try {
                                this.sourceBuffer.appendBuffer(data)
                                return resolve();
                            } catch (e) {
                                if (e.name !== 'QuotaExceededError') {
                                    throw e
                                }
                                // 缓冲已满:清掉播放点之前的数据腾空间,同时把"清到哪里"告诉上层,
                                // 上层据此只遗忘真正被移除的分片,仍在缓冲里的分片继续受保护,避免重复 append
                                const end = Math.max(1, this.video.currentTime - 10);
                                this.trigger('pause', end);
                                this.sourceBuffer.remove(0, end);
                                await sleep(80);
                                continue;
                            }
                        } else {
                            await sleep(10);
                        }
                    } catch (e) {
                        this.trigger('error', e)
                        return reject(e)
                    }
                }
            })
        })
        return this;
    }
}