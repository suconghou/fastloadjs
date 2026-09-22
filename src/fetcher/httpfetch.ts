import { fetchOpts, requestBuilder } from "../types";
import { urlbuilder } from './budiler'

export default class httpfetch {

	private requestBuilder: requestBuilder;

	constructor() {
		this.requestBuilder = urlbuilder;
	}

	async fetch(req: string, start: number, end: number, opts: fetchOpts): Promise<Response> {
		const request: Request = this.requestBuilder(req, start, end);
		return await this.send(request, opts);
	}

	private async send(req: Request, opts: fetchOpts): Promise<any> {
		let signal: AbortSignal = null;
		let controller: AbortController;
		if (typeof AbortController == 'function') {
			controller = new AbortController()
			signal = controller.signal
		}
		let timer: any
		const timeout = new Promise((resolve, reject) => {
			timer = setTimeout(() => {
				if (controller) {
					controller.abort()
				}
				reject(new Error("timeout"))
			}, opts.timeout)
		})
		const f = fetch(req, { signal: signal, cache: opts.cache === false ? 'reload' : 'force-cache' })
		// 竞速结束后立即清理定时器:否则成功返回后它仍会在 opts.timeout 处 abort,
		// 连带掐断交由 parse 处理的 body 读取(读阶段应由 readtimeout 管控)
		return await Promise.race([f, timeout]).finally(() => clearTimeout(timer))
	}
}
