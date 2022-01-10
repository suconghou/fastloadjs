import sidx from './sidx/sidx'
import ebml from './ebml/ebml'

export default class {

    private parser: sidx | ebml;

    constructor(data: DataView, private isSidx: boolean) {
        if (isSidx) {
            this.parser = new sidx(data)
        } else {
            this.parser = new ebml(data)
        }
    }

    parse(indexEndoffset = 0) {
        if (this.isSidx) {
            return this.getInfoSIDX(indexEndoffset)
        }
        return this.getInfoEBML();
    }

    private getInfoSIDX(indexEndoffset: number) {
        const data = this.parser.parse(indexEndoffset);
        return data;
    }

    private getInfoEBML() {
        const data = this.parser.parse() as any;
        const info = [];
        if (data[0] && data[0].children && data[0].children.length) {
            data[0].children.forEach((element: any) => {
                if (element.id == 'bb') {
                    // CuePoint
                    const [CueTime, CueTrackPositions] = element.children
                    const [CueTrack, CueClusterPosition] = CueTrackPositions.children;
                    info.push({
                        cueTime: CueTime.value,
                        cueClusterPosition: CueClusterPosition.value,
                    })
                }
            });
        }
        return info;
    }

}

