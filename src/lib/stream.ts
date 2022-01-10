import { sleep } from './utils/util'
import { httpResponse } from '../lib/types'
import bufferCenter, { globalBuffer } from './utils/bufferCenter'

export default class {

    private globalBuffer: bufferCenter = globalBuffer
    private dataMap: { [name: number]: httpResponse } = {}
    private dataMapArray: Array<httpResponse> = []

    private destroyed: boolean;

    // id = vid:itag
    constructor(private id: string) {

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

}