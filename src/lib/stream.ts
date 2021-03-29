import { sleep } from './utils/util'
import { httpResponse } from '../lib/types'
export default class {

    private stream: ReadableStream

    private index: number = 0
    private dataMap: Object = {}
    private dataMapArray: Array<httpResponse> = []

    private destroyed: boolean;

    constructor(private init: ResponseInit) {
        const _this = this;
        const process = async (c: ReadableStreamDefaultController) => {
            const { data, done, err } = await _this.get()
            if (err) {
                c.error(err)
                return
            }
            if (data) {
                c.enqueue(new Uint8Array(data))
            }
            if (done) {
                c.close()
            }
        }
        this.stream = new ReadableStream({
            async start(c: ReadableStreamDefaultController) {
                await process(c)
            },
            async pull(c: ReadableStreamDefaultController) {
                await process(c)
            }
        })
    }

    private async get() {
        while (true) {
            if (this.destroyed) {
                return { done: true, err: null, data: null }
            }
            const r = this.dataMapArray[this.index]
            if (!r) {
                await sleep(100)
                continue
            }
            this.index++
            return r
        }
    }

    destroy() {
        this.destroyed = true;
    }

    // 提供任意seek能力,方便cachefill
    item(index: number): httpResponse {
        return this.dataMap[index]
    }

    push(index: number, data: httpResponse) {
        this.dataMap[index] = data
        this.dataMapArray.push(data)
    }

    getResponse() {
        return new Response(this.stream, this.init);
    }

}