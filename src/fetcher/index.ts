import httpfetch from "./httpfetch";
import { fetchOpts } from "../types";

export default class fetcher {
	private static fetchInstance = new httpfetch();

	static async fetch(
		req: string,
		start: number,
		end: number,
		opts: fetchOpts
	): Promise<ArrayBuffer> {
		// this.get 抛出的timeout是ttfb超时了,我们在parse里再设计个read的超时
		const res = await this.fetchInstance.fetch(req, start, end, opts);
		return this.parse(res, opts);
	}

	// 解析成stream能识别的格式
	private static async parse(res: Response, opts: fetchOpts): Promise<ArrayBuffer> {
		if (!res.ok) {
			throw new Error(`${res.url} : ${res.statusText || res.status}`)
		}
		let timer: any
		const timeout: Promise<ArrayBuffer> = new Promise((resolve, reject) => {
			timer = setTimeout(() => {
				reject(new Error("readtimeout"))
			}, opts.readtimeout)
		})
		const resdata: Promise<ArrayBuffer> = new Promise(async (resolve, reject) => {
			try {
				const data = await res.arrayBuffer()
				resolve(data);
			}
			catch (e) {
				reject(e);
			}
		})
		// 竞速结束后立即清理定时器,否则readtimeout会空跑到超时周期结束
		return Promise.race([timeout, resdata]).finally(() => clearTimeout(timer))
	}
}
