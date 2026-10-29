import { sleep } from '../util/util'
import { fetchTask } from '../types'

export default class {

	private t: number = 0
	private tasks: Array<fetchTask> = []
	private paused: boolean = false;
	private stopped: boolean = false;

	constructor(private threadNum: number, private retry: number, private callback: Function, private finish?: Function) {

	}

	pause() {
		this.paused = true
	}

	start() {
		this.paused = false
	}

	// 终止所有线程,线程会在100ms内退出,不再空轮询
	destroy() {
		this.stopped = true
	}

	private async thread(threadId: number) {
		while (true) {
			if (this.stopped) {
				break
			}
			if (this.paused) {
				await sleep(100)
				continue
			}
			const task = this.get();
			if (task) {
				const res = await this.do(task)
				if (await this.taskOneDone(res)) {
					// 上层已要求终止(出错或已销毁),立即退出:队列中剩余任务若继续执行,
					// 只会多发几个注定被丢弃的请求,且延迟线程释放
					break
				}
			} else {
				await sleep(100)
			}
		}
		this.taskDone();
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

	private taskDone() {
		this.t--
		if (this.t <= 0 && this.finish) {
			// 如果中间出错终止,这个finish不会被调用.
			this.finish()
		}
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
