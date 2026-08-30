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
		const timeout = new Promise((resolve, reject) => {
			setTimeout(() => {
				if (controller) {
					controller.abort()
				}
				reject("timeout")
			}, opts.timeout)
		})
		const f = fetch(req, { signal: signal, cache: opts.cache === false ? 'reload' : 'force-cache' })
		return await Promise.race([f, timeout])
	}
}
