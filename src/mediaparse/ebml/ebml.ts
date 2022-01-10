

class EBMLParserTypes {
    private static types = {
        '1c53bb6b': ['Cues', 'm'],  // lvl. 1
        'bb': ['CuePoint', 'm'],      // lvl. 2
        'b3': ['CueTime', 'u'],    // lvl. 3
        'b7': ['CueTrackPositions', 'm'],      // lvl. 3
        'f7': ['CueTrack', 'u'],    // lvl. 4
        'f1': ['CueClusterPosition', 'u'],    // lvl. 4
    };

    static info(id: string) {
        if (this.types[id]) {
            return this.types[id];
        }
        return ['', ''];
    }
}

class EBMLParserBuffer {

    private index: number = 0;
    constructor(private data: DataView) {
    }

    parse() {
        if (this.index < this.data.byteLength) {
            return this.readVint();
        }
    }

    private readVint() {
        let s = this.read(1);
        let w = EBMLParserBuffer.vIntWidth(s as number) + 1;
        const id = this.rewind(1).read(w);
        const meta = EBMLParserTypes.info(id.toString(16));
        s = this.read(1);
        w = EBMLParserBuffer.vIntWidth(s as number) + 1;
        const len = this.rewind(1).read(w);
        const lenNum = EBMLParserBuffer.vIntNum(len as number);
        const data = this.read(lenNum, meta[1] == 'u');
        return {
            "id": id.toString(16),
            "meta": meta,
            "data": data,
        };
    }

    // 读n字节
    private read(n: number, number: boolean = true) {
        let r: number | DataView
        const last = this.data.byteLength - this.index
        if (n > last) {
            // warn no data to read , in case of outside set n to last
            n = last
        }
        if (!number) {
            r = new DataView(this.data.buffer, this.data.byteOffset + this.index, n)
            this.index += n;
            return r;
        }
        if (n == 1) {
            r = this.data.getUint8(this.index)
        } else if (n == 2) {
            r = this.data.getUint16(this.index)
        } else if (n == 3) {
            // getUint24
            r = (this.data.getUint16(this.index) << 8) + this.data.getUint8(this.index + 2);
        } else if (n == 4) {
            r = this.data.getUint32(this.index)
        } else if (n >= 5 && n <= 7) {
            let value = 0, start = this.index;
            for (let i = 0; i < n; i++) {
                value *= 2 ** 8
                value += this.data.getUint8(start + i);
            }
            r = value
        } else if (n == 8) {
            r = Number(this.data.getBigUint64(this.index))
        } else {
            r = new DataView(this.data.buffer, this.data.byteOffset + this.index, n)
        }
        this.index += n;
        return r;
    }

    private rewind(n: number) {
        this.index -= n;
        return this;
    }

    // 传入一个字节8位, 判断前多少个bit是0, 返回值可能为 0 - 8
    private static vIntWidth(s: number) {
        if (s < 1) {
            return 8
        }
        let width = 0
        for (width = 0; width < 8; width++) {
            if (s >= 2 ** (7 - width)) {
                break;
            }
        }
        return width;
    }

    // 传入若干个字节 最高位1置为0后转为十进制数
    private static vIntNum(byte: number) {
        let x = byte;
        let k = 0;
        if (x >> (k ^ 32)) k = k ^ 32;
        if (x >> (k ^ 16)) k = k ^ 16;
        if (x >> (k ^ 8)) k = k ^ 8;
        if (x >> (k ^ 4)) k = k ^ 4;
        if (x >> (k ^ 2)) k = k ^ 2;
        if (x >> (k ^ 1)) k = k ^ 1;
        x = x ^ (1 << k);
        return x;
    }


}

class EBMLParserElement {
    public id: string;
    private name: string;
    private type: string;
    private value: any

    private children: Array<EBMLParserElement> = [];

    private buffer: EBMLParserBuffer;
    constructor(data: DataView) {
        this.buffer = new EBMLParserBuffer(data);
    }

    parseElements() {
        let item: any;
        while (item = this.buffer.parse()) {
            const { 'id': id, 'meta': meta, 'data': data } = item;
            const ele = this.parseElement(id, meta, data)
            this.children.push(ele);
        }
        return this.children;
    }

    parseElement(id: string, meta: Array<string>, data: DataView | number) {
        const element = new EBMLParserElement(data as DataView);
        element.id = id;
        [element.name, element.type] = meta
        if (element.type == 'm') {
            element.parseElements();
        } else {
            element.value = element.type == 'u' ? Number(data) : data
        }
        return element;
    }
}

export default class {
    constructor(private data: DataView) {
    }

    parse() {
        const parser = new EBMLParserElement(this.data);
        const data = parser.parseElements();
        return data;
    }
}

