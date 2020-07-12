import { requestBuilder } from "../types";

export const urlbuilder: requestBuilder = (
    req: RequestInfo,
    start: number,
    end: number): Request => {
    const init = {
        method: 'GET',
    }
    const u = req.toString().replace(/\.(mp4|webm)/, `/${start}-${end - 1}.ts`)
    return new Request(u, init);
}