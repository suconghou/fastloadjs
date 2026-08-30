// modified from https://github.com/sindresorhus/fnv1a

const base62Map = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

// fnv1a 64 to base62
export default (str: string) => {
    return base62(Number(fnv1a64(str)));
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

export const fnv1a64 = (str: string): bigint => {
    let hash = 14_695_981_039_346_656_037n;
    const fnvPrime = 1_099_511_628_211n;
    const bytes = (new TextEncoder()).encode(str)
    for (let index = 0; index < bytes.length; index++) {
        const characterCode = bytes[index];
        hash ^= BigInt(characterCode);
        hash = BigInt.asUintN(64, hash * fnvPrime);
    }
    return hash;
}

