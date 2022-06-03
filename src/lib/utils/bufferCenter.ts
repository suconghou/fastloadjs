import { bufferItem, hostsMap } from "../types";

// ttl cache
export default class bufferCenter {

    private readonly buffers: Map<string, Map<number, bufferItem>> = new Map();

    private readonly ttls: Map<string, Map<number, number>> = new Map();

    constructor(private readonly maxItmes: number = 3200, private readonly maxTtl = 600) {
        setInterval(() => this.expire(), 60e3)
    }

    hosts(): hostsMap {
        const infos: hostsMap = {};
        for (const [id, file] of this.buffers) {
            const parts: Array<number> = Array.from(file.keys());
            infos[id] = parts;
        }
        return infos;
    }

    part(id: string): Map<number, bufferItem> {
        if (this.buffers.has(id)) {
            return this.buffers.get(id)
        }
    }

    get(id: string, part: number,): bufferItem {
        if (this.buffers.has(id)) {
            const s = this.buffers.get(id)
            if (s.has(part)) {
                this.ttl(id, part)
                return s.get(part)
            }
        }
    }

    put(buf: bufferItem) {
        const { id, part } = buf;
        this.ttl(id, part)
        if (this.buffers.has(id)) {
            const urlBuf = this.buffers.get(id)
            urlBuf.set(part, buf)
        } else {
            const urlBuf: Map<number, bufferItem> = new Map();
            urlBuf.set(part, buf);
            this.buffers.set(id, urlBuf)
        }
    }

    private ttl(id: string, part: number) {
        if (this.ttls.has(id)) {
            this.ttls.get(id).set(part, Date.now())
        } else {
            const t: Map<number, number> = new Map()
            t.set(part, Date.now())
            this.ttls.set(id, t)
        }
    }

    private expire() {
        let num: number = 0;
        for (const [_, file] of this.buffers) {
            num += file.size
        }
        if (num <= this.maxItmes) {
            return
        }
        const t = Date.now();
        for (const [id, s] of this.ttls) {
            for (const [part, time] of s) {
                if (t - time > this.maxTtl) {
                    s.delete(part)
                    if (this.buffers.has(id)) {
                        this.buffers.get(id).delete(part)
                        if (num-- < this.maxItmes) {
                            break
                        }
                    }
                }
            }
            if (!s.size) {
                this.buffers.delete(id)
                this.ttls.delete(id)
            }
        }
    }

}


export const globalBuffer = new bufferCenter()


