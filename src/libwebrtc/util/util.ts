import wsocket from './ws'
const baseURL = localStorage.getItem('ws') || 'wss://ws.feds.club/uid/'
let uid = '';
export const ws = (ev?: any) => {
    let event = '';
    if (!ev) {
        // ev 传入空字符串清空订阅, 传入false或不传不修改订阅
        event = ev;
    } else {
        event = `rtc:${ev}`;
    }
    const url = baseURL + uuid();
    return wsocket.getWs(
        url,
        (event: any) => {
            const data = JSON.parse(event.data)
            return {
                ev: `${data.event}`,
                data: data
            };
        },
        event
    );
}

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


export const sleep = async (ms: number) => {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
};


const logevel = sessionStorage.getItem('loglevel')

export const warn = ['warn', 'info', 'log'].includes(logevel) ? console.warn.bind(console) : () => { }
export const info = ['info', 'log'].includes(logevel) ? console.info.bind(console) : () => { }
export const log = ['log'].includes(logevel) ? console.log.bind(console) : () => { }

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

export const ab2str = (buf: ArrayBuffer): string => {
    return String.fromCharCode.apply(null, new Uint8Array(buf));
}
export const str2ab = (str: string): ArrayBuffer => {
    const buf = new ArrayBuffer(str.length);
    const bufView = new Uint8Array(buf);
    for (let i = 0, strLen = str.length; i < strLen; i++) {
        bufView[i] = str.charCodeAt(i);
    }
    return buf;
}

export const padRight = (str: string, max: number): string => {
    const n = max - str.length
    if (n > 0) {
        return str + " ".repeat(n)
    }
    return str;
}