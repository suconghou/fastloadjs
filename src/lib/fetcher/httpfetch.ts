import { requestBuilder, fetchOpts } from "../types";
export default class httpfetch {
	private requestBuilder: requestBuilder;
	constructor(builder: requestBuilder) {
		this.requestBuilder = builder ? builder : this.buildRequest;
	}

	async fetch(req: RequestInfo, start: number, end: number, opts: fetchOpts): Promise<Response> {
		const request: Request = this.requestBuilder(req, start, end);
		const res: Promise<Response> = await this.send(request, opts);
		return res;
	}

	private build(start: number, end: number): RequestInit {
		if (start <= 0 && end <= 0) {
			return {
				method: "GET"
			};
		}
		return {
			method: "GET",
			headers: {
				Range: `bytes=${start ? start : 0}-${end ? end - 1 : ""}`
			}
		};
	}

	private buildRequest(
		req: RequestInfo,
		start: number,
		end: number
	): Request {
		const init = this.build(start, end);
		return new Request(req, init);
	}

	private async send(req: Request, opts: fetchOpts): Promise<any> {
		const timeout = new Promise((resolve, reject) => {
			setTimeout(() => {
				reject("timeout")
			}, opts.timeout)
		})
		const f = fetch(req, { cache: opts.cache === false ? 'reload' : 'force-cache' })
		return await Promise.race([f, timeout])
	}
}
