import parser from '/Users/admin/data/git/youtubeproxy/mediaparse/src/index'

import { taskItem, taskItemMap } from '../lib/types'

// 我们的n字段(结束位)统一最大为文件大小,实际请求时按照end-1去请求.最后正好取到末尾
// m的开始值是 indexEndoffset+1, n的结束值是文件大小
function webmTasks(info: any, indexEndoffset: number, len: number) {
    const taskMap = {};
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
            m,
            n,
            no: i,
            begin,
        }
    }
    return taskMap;
}

// 我们的n字段(结束位)统一最大为文件大小,实际请求时按照end-1去请求.最后正好取到末尾
function sidxTasks(info: any) {
    const taskMap = {}
    for (let i = 0; i < info.reference_count; i++) {
        const item = info.references[i]
        const no = i;
        const m = item.startRange
        const n = item.endRange // 因为我们的requestBuilder有end-1的操作,所以我们这里+1;
        const begin = item.startTimeSec;
        taskMap[no] = {
            m,
            n,
            no,
            begin
        }
    }
    return taskMap
}


export default class segments {

    private taskMap: taskItemMap<taskItem> = {}
    private index: number = 0
    public readonly total: number = 0

    constructor(buffer: ArrayBuffer, indexEndoffset: number, totalLen: any, webm: boolean) {
        const s = new parser(new DataView(buffer), !webm)
        const info = s.parse(indexEndoffset);
        if (webm) {
            this.taskMap = webmTasks(info, indexEndoffset, totalLen);
        } else {
            this.taskMap = sidxTasks(info);
        }
        this.total = Object.keys(this.taskMap).length
    }

    next(n: number = 10): Array<taskItem> {
        const resList: Array<taskItem> = [];
        const max = Math.min(this.index + n, this.total);
        let constant = true;
        let nextIndex = this.index;
        for (let i = this.index; i < max; i++) {
            const item = this.taskMap[i];
            if (item.done) {
                if (constant) {
                    nextIndex = item.no + 1;
                }
                continue;
            }
            constant = false;
            resList.push(item);
        }
        this.index = nextIndex;
        return resList;
    }

    isDone(): boolean {
        for (let i = 0; i < this.total; i++) {
            const item = this.taskMap[i]
            if (!item.done) {
                return false;
            }
        }
        return true
    }

    getMap(): taskItemMap<taskItem> {
        return this.taskMap;
    }

    seekTo(n: number) {
        if (n >= this.total) {
            throw new Error("index error")
        }
        this.index = n;
    }

    done(no: number) {
        if (this.taskMap[no]) {
            this.taskMap[no].done = true
        } else {
            console.error("error in done");
        }
    }

}