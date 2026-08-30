// modified from https://github.com/sindresorhus/fnv1a

const base62Map = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

// fnv1a 32 to base62
export default (str: string) => {
    return base62(fnv1a32(str));
}

export const base62 = (num: number): string => {
    const arr: Array<string> = [];
    while (true) {
        const i = num % 62
        arr.unshift(base62Map.charAt(i))
        num = Math.floor(num / 62)
        if (num <= 0) {
            break
        }
    }
    return arr.join('')
}


export const fnv1a32 = (str: string): number => {
    let hash = 2_166_136_261;
    const bytes = (new TextEncoder()).encode(str)
    for (let index = 0; index < bytes.length; index++) {
        const characterCode = bytes[index];
        hash = (hash ^ characterCode) >>> 0; // 每一步的结果都要转化为 uint32
        hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0; // 使用加法而不是乘法才没问题
    }
    return hash;
}

