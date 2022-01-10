export interface fastConfig {
	readonly thread: number;
	readonly retry: number;
	readonly req: string;
	readonly meta: string // vid:itag , for index :  vid:itag|index
	readonly mirrors: Array<string>
	readonly p2p: boolean
}

export interface httpResponse {
	readonly no: number,
	data: ArrayBuffer,
	err: any
}

export interface fetchOpts {
	timeout: number
	readtimeout: number
	cache: boolean
}

export interface requestBuilder {
	(req: string, start: number, end: number): Request;
}

export interface fetchTask extends Function {
	(): Promise<httpResponse>
}


export interface taskItem {
	readonly start: number
	readonly end: number
	readonly no: number
	readonly begin: number
}

export interface taskingItem extends taskItem {
	done: Boolean
	started: number
	rstart: number
}

export interface taskItemMap<T> {
	[key: number]: T;
}


export interface bufferItem {
	readonly id: string
	readonly part: number
	readonly buffer: ArrayBuffer
}

export interface rangeItem {
	start: number,
	end: number,
}

export interface streamItem {
	readonly req: string,
	readonly init: rangeItem,
	readonly index: rangeItem,
	readonly mimeCodec: string,
	readonly len: number,
	readonly meta: string,
	readonly mirrors: Array<string>
}