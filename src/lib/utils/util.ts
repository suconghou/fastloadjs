
export const sleep = async (ms: number) => {
	return new Promise(resolve => {
		setTimeout(resolve, ms);
	});
};


export class asyncQueue {

	private tasks: Array<Function>;
	private runing: boolean;
	constructor(tasks: Array<Function>) {
		this.tasks = tasks;
		this.run();
	}
	push(task: Function) {
		this.tasks.push(task);
		this.run();
	}
	clear() {
		this.tasks = [];
	}
	async run() {
		if (this.runing) {
			return;
		}
		this.runing = true;
		let item: any;
		while ((item = this.tasks.shift())) {
			try {
				await item();
			} catch (e) {
				// ignore error
				console.error(e)
			}
		}
		this.runing = false;
	}
}

