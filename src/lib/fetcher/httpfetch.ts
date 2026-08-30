import { fetchOpts } from "../../types";

export default class httpfetch {

	async fetch(url: string, opts: fetchOpts): Promise<ArrayBuffer> {
		const init = {
			method: 'GET',
		}
		const request = new Request(url, init);
		const res: Response = await this.send(request, opts);
		return await this.parse(res, opts);
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

	// 读取body为arraybuffer
	private async parse(res: Response, opts: fetchOpts): Promise<ArrayBuffer> {
		if (!res.ok) {
			throw new Error(`${res.url} : ${res.statusText || res.status}`)
		}
		const timeout: Promise<ArrayBuffer> = new Promise((resolve, reject) => {
			setTimeout(() => {
				reject("readtimeout")
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
		return Promise.race([timeout, resdata])
	}

}
