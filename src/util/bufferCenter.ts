import { bufferItem, hostsMap } from "../types";

// ttl cache
export default class bufferCenter {

    private readonly buffers: Map<string, Map<number, bufferItem>> = new Map();

    private readonly ttls: Map<string, Map<number, number>> = new Map();

    constructor(private readonly maxItmes: number = 2000, private readonly maxTtl = 600) {
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

    part(id: string): Map<number, bufferItem> | undefined {
        if (this.buffers.has(id)) {
            return this.buffers.get(id)
        }
    }

    get(id: string, part: number,): bufferItem | undefined {
        const s = this.buffers.get(id)
        if (s) {
            const buf = s.get(part)
            if (buf) {
                this.ttl(id, part)
                return buf
            }
        }
    }

    put(buf: bufferItem) {
        const { id, part } = buf;
        this.ttl(id, part)
        const urlBuf = this.buffers.get(id)
        if (urlBuf) {
            urlBuf.set(part, buf)
        } else {
            const uBuf: Map<number, bufferItem> = new Map();
            uBuf.set(part, buf);
            this.buffers.set(id, uBuf)
        }
    }

    private ttl(id: string, part: number) {
        const tt = this.ttls.get(id)
        if (tt) {
            tt.set(part, Date.now())
        } else {
            const t: Map<number, number> = new Map()
            t.set(part, Date.now())
            this.ttls.set(id, t)
        }
    }

    private expire() {
        const t = Date.now();
        // 1. 按TTL过期:超过maxTtl未被访问的条目直接删除
        for (const [id, s] of this.ttls) {
            for (const [part, time] of s) {
                if (t - time > this.maxTtl) {
                    s.delete(part)
                    this.buffers.get(id)?.delete(part)
                }
            }
            if (!s.size) {
                this.buffers.delete(id)
                this.ttls.delete(id)
            }
        }
        // 2. 容量兜底:活跃分片不断被访问导致TTL不过期时,按最近访问时间从旧到新淘汰,保证总量不超过maxItmes
        let total: number = 0;
        for (const file of this.buffers.values()) {
            total += file.size
        }
        if (total <= this.maxItmes) {
            return
        }
        const all: Array<{ id: string, part: number, time: number }> = [];
        for (const [id, s] of this.ttls) {
            for (const [part, time] of s) {
                all.push({ id, part, time })
            }
        }
        all.sort((a, b) => a.time - b.time)
        for (const it of all) {
            if (total <= this.maxItmes) {
                break
            }
            this.ttls.get(it.id)?.delete(it.part)
            this.buffers.get(it.id)?.delete(it.part)
            total--
        }
        for (const [id, s] of this.ttls) {
            if (!s.size) {
                this.buffers.delete(id)
                this.ttls.delete(id)
            }
        }
    }

}


export const globalBuffer = new bufferCenter()


