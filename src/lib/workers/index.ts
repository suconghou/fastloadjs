import { sleep } from '../utils/util'

export default class {

	private t: number = 0
	private tasks: Array<Function> = []
	public pause: boolean = false;

	constructor(private threadNum: number, private retry: number, private callback: Function, private finish: Function) {

	}

	private async thread(threadId: number) {
		let last = false
		while (true) {
			if (this.pause) {
				await sleep(100)
				continue
			}
			const task = this.get();
			if (task) {
				const res = await this.do(task)
				if (await this.taskOneDone(res)) {
					// 回调以后是否派发了下一个任务,没有下一个任务了,这个返回true,标记最后
					last = true
				}
			} else {
				await sleep(100)
				// worker停止的条件是 任务队列已近是空的了,并且之前回调已响应没有后续任务
				if (last) {
					break
				}
			}

		}
		this.taskDone();
	}

	push(task: Function) {
		this.tasks.push(task)
		if (this.t < this.threadNum) {
			this.thread(this.t)
			this.t++
		}
	}

	private get(): Function {
		return this.tasks.pop()
	}

	private async taskOneDone(res: any) {
		// console.info("one ok", res)
		return await this.callback(res)
	}

	private taskDone() {
		this.t--
		if (this.t <= 0) {
			// 如果中间出错终止,这个finish不会被调用.
			this.finish()
		}
	}

	private async do(task: Function) {
		const retry = this.retry
		let res: any = {};
		for (let i = 0; i < retry; i++) {
			try {
				res = await task();
				break
			} catch (e) {
				console.error(e)
			}
		}
		return res;
	}

}
