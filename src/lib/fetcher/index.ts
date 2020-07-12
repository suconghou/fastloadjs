import { urlbuilder } from './budiler'
import httpfetch from "./httpfetch";
import { httpResponse, fetchOpts } from "../types";

export default class fetcher {
	private static fetchInstance: httpfetch;
	private static async get(
		req: RequestInfo,
		start: number,
		end: number,
		opts: fetchOpts
	): Promise<Response> {
		if (!this.fetchInstance) {
			this.fetchInstance = new httpfetch(urlbuilder);
		}
		const res = await this.fetchInstance.fetch(req, start, end, opts);
		return res;
	}

	static async fetch(
		req: RequestInfo,
		start: number,
		end: number,
		opts: fetchOpts
	): Promise<httpResponse> {
		const res = await this.get(req, start, end, opts);
		return this.parse(res);
	}

	// 解析成stream能识别的格式
	private static async parse(res: Response): Promise<httpResponse> {
		try {
			if (![200, 206, 304].includes(res.status)) {
				throw new Error(res.statusText)
			}
			const data = await res.arrayBuffer()
			return { no: null, data: data, err: null, };
		} catch (e) {
			return { no: null, err: e, data: null }
		}
	}
}
