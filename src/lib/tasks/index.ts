
import fetcher from '../fetcher/index'
import { httpResponse, fetchOpts } from '../types'

export default class {
	constructor() {

	}
	// 再此处理重试逻辑, 此处校验数据, 此处的n值,实际在range时,需要-1
	static wrap(retry: number, urlFn: (() => RequestInfo), m: number, n: number, no: number): Function {
		return async () => {
			let res: httpResponse,
				url: RequestInfo;
			const size = n - m;
			let opts: fetchOpts = {
				timeout: 15e3,
				readtimeout: 30e3,
				cache: true,
			};
			for (let i = 0; i < retry; i++) {
				try {
					url = urlFn();
					res = await fetcher.fetch(url, m, n, opts);
					res.no = no
					res.err = null
					const r = res.data ? res.data.byteLength : -1;
					if (r !== size) {
						// disable cache and try again
						throw new Error(`short read error:expect ${size},got ${r}`);
					}
					break
				} catch (e) {
					opts.cache = false
					console.error(e, i, url, m, n, no)
					res = { no: no, err: e, data: null }
					await new Promise((resolve) => {
						setTimeout(resolve, 1000)
					})
				}
			}
			return res;
		}
	}
}
