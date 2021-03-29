export interface fastConfig {
	readonly thread?: number;
	readonly thunk?: number;
	readonly retry?: number;
	readonly start: number;
	readonly end: number
	readonly req: RequestInfo;
	readonly meta: string
	readonly mirrors: Array<string>
	readonly nop2p: boolean
}

export interface httpResponse {
	no: number,
	data: ArrayBuffer,
	err: any
	done?: Boolean
}

export interface fetchOpts {
	timeout: number
	readtimeout: number
	cache: boolean
}

export interface requestBuilder {
	(req: RequestInfo, start: number, end: number): Request;
}

interface nextFunction extends Function {
	(n?: number): Array<taskItem>
}

export interface dispatcher {
	total: number
	next: nextFunction
	getMap: Function
	seekTo: Function
	done: Function
}

export interface taskItem {
	m: number
	n: number
	no: number
	begin: number
	done: Boolean
	start: number
	rstart: number
}
export interface taskItemMap<T> {
	[key: number]: T;
}