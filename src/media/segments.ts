import parser from '/Users/admin/data/git/youtubeproxy/mediaparse/src/index'


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


function sidxTasks(info: any) {
    const taskMap = {}
    for (let i = 0; i < info.reference_count; i++) {
        const item = info.references[i]
        const no = i;
        const m = item.startRange
        const n = item.endRange + 1
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

    private taskMap: any = {}
    private index: number = 0

    constructor(buffer: ArrayBuffer, indexEndoffset: number, totalLen: any, webm: boolean) {
        const s = new parser(new DataView(buffer), !webm)
        const info = s.parse(indexEndoffset);
        if (webm) {
            this.taskMap = webmTasks(info, indexEndoffset, totalLen);
        } else {
            this.taskMap = sidxTasks(info);
        }
    }

    get total(): number {
        return Object.keys(this.taskMap).length
    }


    // 此处需要轮询一遍,查漏
    next() {
        const r = this.taskMap[this.index]
        if (r && !r.done && !(r.start || r.rstart)) {
            this.index++
            r.start = true
            return r
        }
        // 查找跳过的
        for (let i = this.index; i < this.total; i++) {
            const item = this.taskMap[i]
            if (!item.done && !item.start) {
                item.start = true
                this.index = item.no + 1
                return item;
            }
        }
        for (let i = 0; i < this.total; i++) {
            const item = this.taskMap[i]
            if (!item.done && !item.start) {
                item.start = true
                return item;
            }
        }
    }

    // rtc 任务需要比http任务分离遍历,调用方需修改其rstart属性,将0修改为true,代表确实发出查询了
    rtcNext() {
        for (let i = this.index; i < this.total; i++) {
            const item = this.taskMap[i]
            if (!item.done && !item.rstart && !item.start) {
                item.rstart = 0
                return item;
            }
        }
        for (let i = this.index; i < this.total; i++) {
            const item = this.taskMap[i]
            if (!item.done && !item.rstart) {
                item.rstart = 0
                return item;
            }
        }
    }

    getMap() {
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

    // 计算从当前http下载点到结尾,有多少rtc已探测并等待结果的
    get rtcWaitCount(): number {
        let num = 0
        for (let i = this.index; i < this.total; i++) {
            const item = this.taskMap[i]
            if (item && !item.done && item.rstart) {
                num++
            }
        }
        return num;
    }

}