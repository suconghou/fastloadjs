import parser from './mediaparse/index'

import { taskItem, objectMap } from './lib/types'

// 我们的n字段(结束位)统一最大为文件大小,实际请求时按照end-1去请求.最后正好取到末尾
// m的开始值是 indexEndoffset+1, n的结束值是文件大小
function webmTasks(info: any, indexEndoffset: number, len: number): objectMap<taskItem> {
    const taskMap: objectMap<taskItem> = {};
    const first = info[0];
    const segmentStart = indexEndoffset - first.cueClusterPosition + 1;
    const segmentEnd = len;
    for (let i = 0; i < info.length; i++) {
        const begin = info[i].cueTime / 1e3;
        const m = info[i].cueClusterPosition + segmentStart;
        let end = 0
        if (i < info.length - 1) {
            end = info[i + 1].cueClusterPosition + segmentStart;
        } else {
            end = segmentEnd;
        }
        const n = end
        taskMap[i] = {
            start: m,
            end: n,
            no: i,
            begin,
        }
    }
    return taskMap;
}

// 我们的n字段(结束位)统一最大为文件大小,实际请求时按照end-1去请求.最后正好取到末尾
function sidxTasks(info: any): objectMap<taskItem> {
    const taskMap: objectMap<taskItem> = {}
    for (let i = 0; i < info.reference_count; i++) {
        const item = info.references[i]
        const no = i;
        const m = item.startRange
        const n = item.endRange
        const begin = item.startTimeSec;
        taskMap[no] = {
            start: m,
            end: n,
            no,
            begin
        }
    }
    return taskMap
}


export default class {

    private taskMap: objectMap<taskItem> = {}
    private index: number = 0
    public readonly total: number = 0
    constructor(buffer: ArrayBuffer, indexEndoffset: number, totalLen: number, webm: boolean) {
        const s = new parser(new DataView(buffer), !webm)
        const info = s.parse(indexEndoffset);
        if (webm) {
            this.taskMap = webmTasks(info, indexEndoffset, totalLen);
        } else {
            this.taskMap = sidxTasks(info);
        }
        this.total = Object.keys(this.taskMap).length
    }

    // 供 http 和 rtc 任务抢占,下次调用，从连续buffer断开处开始
    next(n: number = 10, check: (no: number) => boolean): Array<taskItem> {
        const resList: Array<taskItem> = [];
        const max = Math.min(this.index + n, this.total);
        let continuity = true;
        let nextIndex = this.index;
        for (let i = this.index; i < max; i++) {
            const item = this.taskMap[i];
            if (check(item.no)) {
                if (continuity) {
                    nextIndex = item.no + 1;
                }
                continue;
            }
            continuity = false;
            resList.push(item);
        }
        this.index = nextIndex;
        return resList;
    }

    getMap(): objectMap<taskItem> {
        return this.taskMap;
    }

    seekTo(n: number) {
        if (n >= this.total) {
            throw new Error("seek error")
        }
        this.index = n;
    }

}