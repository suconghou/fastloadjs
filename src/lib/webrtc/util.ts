import ws from '../../util/ws'
import { uuid, str2ab, concatArrayBuffers } from '../../util/util';
import { rtcRecv } from '../../types';


let $ws: ws;

export default (addr: string): ws => {
    if (!$ws) {
        $ws = new ws(addr + uuid())
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

// 协议打包，解包
// 协议头|版本号|头部长度

// 二进制协议
// protocol 16位 0x7363
// 8位
const protocol = [0x73, 0x63];
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
        data: body,
        t: Date.now(),
    }
    return ret
}


export const encode = (data: ArrayBuffer, id: string, sn: number, i: number, n: number): ArrayBuffer => {
    const str = JSON.stringify([id, sn, i, n]);
    const x = new Uint8Array([protocol[0], protocol[1], version, str.length]);
    const header = concatArrayBuffers(x.buffer, str2ab(str))
    return concatArrayBuffers(header, data);
}


export const isServer = (uid: string) => {
    if (!uid.startsWith('ss')) {
        return false
    }
    const [a, b] = uid.substring(uid.length - 2).split('').map(item => item.charCodeAt(0));
    const payload = uid.substring(2, uid.length - 2)
    const sum = payload.split('').reduce((num, c) => num + c.charCodeAt(0), 0)
    return (sum % a) == b;
}


export const candidateInfo = (str: string): RTCIceCandidate => {
    const r = /:(?<foundation>\d+)\s+\d\s+(?<protocol>[a-zA-Z]{3})\s+(?<priority>\d+)\s+(?<address>[\w\-\.]+)\s+(?<port>\d+)\s+typ\s+(?<type>[a-z]+)(?:\s+raddr\s+(?<relatedAddress>[\w\-\.]+)\s+rport\s+(?<relatedPort>\d+)(?:.+ufrag\s+(?<usernameFragment>\w+))?)?/;
    const match = str.match(r);
    if (match) {
        return match.groups as unknown as RTCIceCandidate;
    }
    return null
}
