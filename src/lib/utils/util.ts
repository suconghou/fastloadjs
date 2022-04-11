

const logevel = sessionStorage.getItem('loglevel')

export const warn = ['warn', 'info', 'log'].includes(logevel) ? console.warn.bind(console) : () => { }
export const info = ['info', 'log'].includes(logevel) ? console.info.bind(console) : () => { }
export const log = ['log'].includes(logevel) ? console.log.bind(console) : () => { }


export const sleep = async (ms: number) => {
	return new Promise(resolve => {
		setTimeout(resolve, ms);
	});
};


export const eqSet = (as: Set<any>, bs: Set<any>): boolean => {
	if (as.size !== bs.size) return false;
	for (const a of as) if (!bs.has(a)) return false;
	return true;
}


// 向统计组件传递数据
export const emit = (...args: any) => {
	const w = window as any;
	if (w.__fastloadjs_p2p_stat && Array.isArray(w.__fastloadjs_p2p_stat)) {
		(w.__fastloadjs_p2p_stat as Array<any>).forEach((item) => item.$emit(...args))
	} else {
		console.warn("no stat instance   ", ...args)
	}
}

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

