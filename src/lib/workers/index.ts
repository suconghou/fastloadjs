import { sleep } from '../utils/util'
import { fetchTask } from '../types'

export default class {

	private t: number = 0
	private tasks: Array<fetchTask> = []
	private paused: boolean = true;

	constructor(private threadNum: number, private retry: number, private callback: Function) {

	}

	pause() {
		this.paused = true
	}

	start() {
		this.paused = false
	}

	private async thread(threadId: number) {
		let last = false
		while (true) {
			if (this.paused) {
				await sleep(500)
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
		this.t--
	}

	push(task: fetchTask) {
		this.tasks.push(task)
		if (this.t < this.threadNum) {
			this.thread(this.t)
			this.t++
		}
	}

	private get(): fetchTask {
		return this.tasks.pop()
	}

	private async taskOneDone(res: any) {
		// console.info("one ok", res)
		return await this.callback(res)
	}

	private async do(task: fetchTask) {
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
