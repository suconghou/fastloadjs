// https://dashif-documents.azurewebsites.net/Guidelines-TimingModel/master/Guidelines-TimingModel.html#addressing-indexed-indexstructure

export default class {


    constructor(private data: DataView) {
    }

    parse(indexEndoffset = 0) {
        const data = this.data
        let pos = 8; // 跳过8字节header
        const versionAndFlags = data.getUint32(pos)
        const version = versionAndFlags >>> 24; // version 只是高8位
        const flags = versionAndFlags & 0xFFFFFF
        pos += 4
        const referenceId = data.getUint32(pos);
        pos += 4
        const timeScale = data.getUint32(pos);
        pos += 4
        let earliest_presentation_time = 0, first_offset = 0;
        if (version == 0) {
            earliest_presentation_time = data.getUint32(pos)
            pos += 4
            first_offset = data.getUint32(pos)
            pos += 4
        } else {
            earliest_presentation_time = Number(data.getBigUint64(pos))
            pos += 8
            first_offset = Number(data.getBigUint64(pos))
            pos += 8
        }
        first_offset += indexEndoffset + 1
        // skip reserved
        pos += 2
        const reference_count = data.getUint16(pos)
        pos += 2;
        const references = [];
        let time = earliest_presentation_time;
        let offset = first_offset;
        for (let i = 0; i < reference_count; i++) {
            const reference_type = 0;
            const reference_size = data.getUint32(pos)
            pos += 4;
            const subsegment_duration = data.getUint32(pos)
            pos += 4
            // 下面是 starts_with_SAP, SAP_type, SAP_delta_time 没用到,这里忽略掉
            pos += 4
            const startRange = offset
            const endRange = offset + reference_size;
            references.push({
                "reference_type": reference_type,
                "reference_size": reference_size,
                "subsegment_duration": subsegment_duration,
                "durationSec": subsegment_duration / timeScale,
                "startTimeSec": time / timeScale,
                "startRange": startRange,
                "endRange": endRange,
            })
            offset += reference_size
            time += subsegment_duration
        }
        return {
            "version": version,
            "flag": flags,
            "referenceId": referenceId,
            "timeScale": timeScale,
            "earliest_presentation_time": earliest_presentation_time,
            "first_offset": first_offset,
            "reference_count": reference_count,
            "references": references,
        }
    }
}