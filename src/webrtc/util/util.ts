import { rtcRecv } from '../../lib/types';
import wsocket from './ws'
let uid = '';
let $ws: wsocket;
export const singal = (addr: string): wsocket => {
    if (!$ws) {
        $ws = new wsocket(addr + uuid())
        $ws.listen('message', (ev: MessageEvent) => {
            try {
                if (typeof ev.data == 'string') {
                    const data = JSON.parse(ev.data)
                    if (!data.event) {
                        return console.warn(data)
                    }
                    return $ws.trigger(data.event, data)
                }
                return console.warn(ev.data)
            } catch (e) {
                console.error(e)
            }
        })
    }
    return $ws
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


// 协议打包，解包
// 协议头|版本号|头部长度

// 二进制协议
// protocol 16位 0x7363
// 8位
const protocol = [0x73, 0x64];
const version = 0xa1
// 长度8位
export const decode = (data: ArrayBuffer): rtcRecv => {
    const x = new Uint8Array(data)
    if (x.length < 4) {
        throw new Error("bad msg");
    }
    if (!(x[0] === protocol[0] && x[1] === protocol[1])) {
        throw new Error("mismatch protocol")
    }
    if (x[2] !== version) {
        throw new Error("mismatch version")
    }
    const l = x[3]
    const meta = x.slice(4, 4 + l)
    const body = data.slice(4 + l)
    const metaStr = String.fromCharCode.apply(null, meta);
    const [id, sn, i, n] = JSON.parse(metaStr)
    const ret: rtcRecv = {
        id,
        sn,
        i,
        n,
        data: body
    }
    return ret
}


export const encode = (data: ArrayBuffer, id: string, sn: number, i: number, n: number): ArrayBuffer => {
    const str = JSON.stringify([id, sn, i, n]);
    const x = new Uint8Array([protocol[0], protocol[1], version, str.length]);
    const header = concatArrayBuffers(x.buffer, str2ab(str))
    return concatArrayBuffers(header, data);
}


export const isServer = (uuid: string) => {
    return uuid.startsWith('SS') && uuid.endsWith('SS')
}