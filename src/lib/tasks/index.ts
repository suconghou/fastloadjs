
import fetcher from '../fetcher/index'
import stream from "../stream";
import { sleep, } from '../../lib/utils/util'
import { httpResponse, fetchOpts, fetchTask } from '../types'

export default class {
	constructor() {

	}
	// 再此处理重试逻辑, 此处校验数据, 此处的n值,实际在range时,需要-1
	static wrap(retry: number, urlFn: (() => RequestInfo), m: number, n: number, no: number, stream: stream): fetchTask {
		return async (): Promise<httpResponse> => {
			let res: httpResponse = { no: no, data: null, err: null };
			let url: RequestInfo;
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
						throw new Error(`short read error:expect ${size},got ${r}`);
					}
					// 下载完成,并且检查没有错误,则中断循环返回
					break
				} catch (e) {
					// 如果这次下载失败,但是我们检查结果,可能rtc已经成功了,放弃本次http任务
					if (stream.item(no)) {
						console.info("http error but rtc ok", m, n, no)
						return res
					}
					opts.cache = false
					console.error(e, i, url, m, n, no)
					res = { no: no, err: e, data: null }
					await sleep(2e3)
					opts.timeout += 5e3;
				}
			}
			return res;
		}
	}
}
