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
}

export interface fetchOpts {
	timeout: number
	readtimeout: number
	cache: boolean
}

export interface requestBuilder {
	(req: RequestInfo, start: number, end: number): Request;
}

export interface dispatcher {
	total: number
	next: Function
	rtcNext: Function
	getMap: Function
	seekTo: Function
	done: Function
}
