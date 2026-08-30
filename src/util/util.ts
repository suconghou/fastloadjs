
let uid = '';

export const uuid = () => {
    if (uid) {
        return uid;
    }
    uid = sessionStorage.getItem('uid')
    if (!uid || uid.length != 36) {
        function S4() {
            return (((1 + Math.random()) * 0x10000) | 0).toString(36)
        }
        uid = (S4() + S4() + "-" + S4() + "-" + S4() + "-" + S4() + "-" + S4() + S4() + S4());
        sessionStorage.setItem('uid', uid)
    }
    return uid
}


const logevel = sessionStorage.getItem('loglevel')

export const log_warn = ['warn', 'info', 'log'].includes(logevel) ? console.warn.bind(console) : () => { }
export const log_info = ['info', 'log'].includes(logevel) ? console.info.bind(console) : () => { }
export const log_log = ['log'].includes(logevel) ? console.log.bind(console) : () => { }



export const ab2str = (buf: ArrayBuffer): string => {
    return String.fromCharCode.apply(null, new Uint8Array(buf));
}


export const sleep = async (ms: number) => {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
};


export const str2ab = (str: string): ArrayBuffer => {
    const buf = new ArrayBuffer(str.length);
    const bufView = new Uint8Array(buf);
    for (let i = 0, strLen = str.length; i < strLen; i++) {
        bufView[i] = str.charCodeAt(i);
    }
    return buf;
}

export const concatArrayBuffers = (buffer1: ArrayBuffer, buffer2: ArrayBuffer): ArrayBuffer => {
    if (!buffer1) {
        return buffer2;
    } else if (!buffer2) {
        return buffer1;
    }
    const tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
    tmp.set(new Uint8Array(buffer1), 0);
    tmp.set(new Uint8Array(buffer2), buffer1.byteLength);
    return tmp.buffer;
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

