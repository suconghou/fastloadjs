
import fetcher from '../fetcher/index'
import { sleep, } from '../util/util'
import { partResponse, fetchOpts, fetchTask, taskItem } from '../types'
import { globalBuffer } from '../util/bufferCenter';

export default class {

	// 处理mirrors负载策略,item我们只用start,end,no三个字段,id和no用于重试时查找globalBuffer缓存,下载成功后存储到globalBuffer
	// cacheable=false 用于 init/index 这类一次性请求:它们不参与分片缓存(否则会被 hosts() 当成已持有的分片广播给 peer),
	// 也避免两个不同 payload 共用同一个 no 时互相命中缓存
	static wrap(item: taskItem, id: string, retry: number, req: string, mirrorsList: Array<string>, cacheable: boolean = true): fetchTask {
		const { start, end, no } = item
		let i = 0;
		const used: Array<string> = []
		const mirrors = [req].concat(mirrorsList)
		const urlFn = () => {
			i++
			// 首次使用取余算法,固定的分片序号被分配到固定的镜像上,首位镜像有较高权重
			let u = mirrors[no % mirrors.length]
			if (i <= 1) {
				used.push(u)
				return u
			}
			// 重试时排除之前使用的镜像然后在剩余镜像里随机
			u = this.getBestURL(mirrors, used);
			used.push(u)
			return u
		}
		return this.retry(retry, urlFn, id, start, end, no, cacheable)
	}

	// 再此处理重试逻辑, 此处校验数据, 此处的end值,实际在range时,需要-1
	private static retry(retry: number, urlFn: (() => string), id: string, start: number, end: number, no: number, cacheable: boolean = true): fetchTask {
		return async (): Promise<partResponse> => {
			const res: partResponse = { no: no, data: null, err: null };
			if (cacheable) {
				const buf = globalBuffer.get(id, no)
				if (buf) {
					res.data = buf.buffer
					return res
				}
			}
			let url: string;
			const size = end - start;
			let opts: fetchOpts = {
				timeout: 15e3,
				readtimeout: 30e3,
				cache: true,
			};
			for (let i = 0; i < retry; i++) {
				try {
					url = urlFn();
					res.data = await fetcher.fetch(url, start, end, opts);
					res.err = null
					const r = res.data ? res.data.byteLength : -1;
					if (r !== size) {
						throw new Error(`short read error:expect ${size},got ${r}`);
					}
					// 下载完成,并且检查没有错误,则中断循环返回
					if (cacheable) {
						globalBuffer.put({ id, part: no, buffer: res.data })
					}
					break
				} catch (e) {
					// 如果这次下载失败,但是我们检查结果,可能rtc已经成功了,放弃本次http任务
					const buf = cacheable ? globalBuffer.get(id, no) : null
					if (buf) {
						console.info("http error but rtc ok", start, end, no)
						res.err = null;
						res.data = buf.buffer;
						return res
					}
					opts.cache = false
					console.error(e, i, url, start, end, no)
					res.err = e;
					// 失败的尝试必须清掉 data:short read 等校验失败时 data 已被赋值,
					// 上层 taskDone 先判 res.data,会把半截数据当成功写入 sourceBuffer
					res.data = null
					await sleep(2e3)
					opts.timeout += 5e3;
				}
			}
			return res;
		}
	}

	// 这个是第二次及以后重试的,排除之前使用的,然后在剩余里随机,如果都使用过,则重新随机
	private static getBestURL(mirrors: string[], used: string[]): string {
		const m = mirrors.filter(item => !used.includes(item))
		if (m.length) {
			return m[Math.floor(Math.random() * m.length)]
		}
		used.length = 0
		return mirrors[Math.floor(Math.random() * mirrors.length)]
	}

}
