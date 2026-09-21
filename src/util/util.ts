
let uid: string | null = '';

export const uuid = () => {
    if (uid) {
        return uid;
    }
    uid = sessionStorage.getItem('uid')
    if (!uid || uid.length != 36) {
        // 每段固定4字符,8段+4个连字符恒等于36,与下面的length校验匹配,保证uid在会话内稳定复用
        function S4() {
            return ('000' + (((1 + Math.random()) * 0x10000) | 0).toString(36)).slice(-4)
        }
        uid = (S4() + S4() + "-" + S4() + "-" + S4() + "-" + S4() + "-" + S4() + S4() + S4());
        sessionStorage.setItem('uid', uid)
    }
    return uid
}


const logevel = sessionStorage.getItem('loglevel') || ''

export const log_warn = ['warn', 'info', 'log'].includes(logevel) ? console.warn.bind(console) : () => { }
export const log_info = ['info', 'log'].includes(logevel) ? console.info.bind(console) : () => { }
export const log_log = ['log'].includes(logevel) ? console.log.bind(console) : () => { }



export const ab2str = (buf: ArrayBuffer, encoding: string = 'utf-8'): string => {
    const decoder = new TextDecoder(encoding);
    return decoder.decode(buf);
};

export const sleep = async (ms: number) => {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
};


export const str2ab = (str: string): ArrayBuffer => {
    const encoder = new TextEncoder();
    const uint8Array = encoder.encode(str);
    return uint8Array.buffer;
};

export const concatArrayBuffers = (buffers: Array<ArrayBuffer>): ArrayBuffer => {
    const l = buffers.reduce((prev, curr) => prev + curr.byteLength, 0);
    const buf = new Uint8Array(l);
    let offset = 0;
    for (const item of buffers) {
        buf.set(new Uint8Array(item), offset);
        offset += item.byteLength;
    }
    return buf.buffer;
};


export const eqSet = (as: Set<any>, bs: Set<any>): boolean => {
    if (as.size !== bs.size) return false;
    for (const a of as) if (!bs.has(a)) return false;
    return true;
}

// 向统计组件传递数据
export const emit = (...args: any) => {
    const w = window as any;
    if (w.__hls_p2p_stat && Array.isArray(w.__hls_p2p_stat)) {
        (w.__hls_p2p_stat as Array<any>).forEach((item) => item.$emit(...args))
    }
}

// 串行异步任务队列,buffer写入使用
export class asyncQueue {

    private tasks: Array<Function>;
    private runing: boolean;
    constructor(tasks: Array<Function>) {
        this.tasks = tasks;
        this.run();
    }
    push(task: Function) {
        this.tasks.push(task);
        this.run();
    }
    clear() {
        this.tasks = [];
    }
    async run() {
        if (this.runing) {
            return;
        }
        this.runing = true;
        let item: any;
        while ((item = this.tasks.shift())) {
            try {
                await item();
            } catch (e) {
                // ignore error
                console.error(e)
            }
        }
        this.runing = false;
    }
}

