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
		// this.get 抛出的timeout是ttfb超时了,我们在parse里再设计个read的超时
		const res = await this.get(req, start, end, opts);
		return this.parse(res, opts);
	}

	// 解析成stream能识别的格式
	private static async parse(res: Response, opts: fetchOpts): Promise<httpResponse> {
		if (!res.ok) {
			throw new Error(`${res.url} : ${res.statusText || res.status}`)
		}
		const timeout: Promise<httpResponse> = new Promise((resolve, reject) => {
			setTimeout(() => {
				reject("readtimeout")
			}, opts.readtimeout)
		})
		const resdata: Promise<httpResponse> = new Promise(async (resolve, reject) => {
			try {
				const data = await res.arrayBuffer()
				resolve({ no: null, data: data, err: null });
			}
			catch (e) {
				reject(e);
			}
		})
		return Promise.race([timeout, resdata])
	}
}
