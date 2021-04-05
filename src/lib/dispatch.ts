import { taskItem, taskItemMap } from './types'

export default class {

    private taskMap: any = {}
    private index: number = 0
    public readonly total: number = 0

    constructor(thunk: number, start: number, end: number) {
        if (!isFinite(start) || !isFinite(end) || start > end) {
            throw new Error("invalid start or end");
        }
        let no = 0
        let x = start
        let last = false
        while (true) {
            const m = x
            let n = m + thunk
            if (n > end) {
                n = end
                last = true
            }
            if (m >= n) {
                break;
            }
            this.taskMap[no] = {
                m,
                n,
                no
            }
            if (last) {
                break;
            }
            x = n
            no++
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