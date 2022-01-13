import { event, sleep, asyncQueue } from './utils/util'

// 共计抛出事件  pause / error
// error 被顶级处理， pause 被所属fastloader处理
export default class extends event {

    private sourceBuffer: SourceBuffer

    private q = new asyncQueue([])

    private destroyed: boolean = false;

    constructor(private video: HTMLMediaElement, private mediaSource: MediaSource, mimeCodec: string) {
        super()
        const sourceBuffer = mediaSource.addSourceBuffer(mimeCodec)
        sourceBuffer.addEventListener('abort', (e) => {
            console.info(e)
        })
        sourceBuffer.addEventListener('error', (e) => {
            console.error(e)
        })
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
                                this.trigger('pause');
                                this.sourceBuffer.remove(0, Math.max(1, this.video.currentTime - 10));
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