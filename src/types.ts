export interface fastConfig {
	readonly thread: number;
	readonly wsize: number
	readonly retry: number;
	readonly req: string;
	readonly meta: string // vid:itag , for part :  vid:itag|part
	readonly tracker: string
	readonly mirrors: Array<string>
	readonly rtcConf: RTCConfiguration,
}

export interface partResponse {
	readonly no: number,
	data: ArrayBuffer,
	err: Error
}

export interface fetchOpts {
	timeout: number
	readtimeout: number
	cache: boolean
}


export interface fetchTask extends Function {
	(): Promise<partResponse>
}


export interface taskItem {
	readonly start: number
	readonly end: number
	readonly no: number
	readonly begin: number
}

export interface objectMap<T> {
	[key: number]: T;
}


export interface objectStrMap<T> {
	[key: string]: T
}


export interface hostsMap {
	[key: string]: Array<number>
}


export interface bufferItem {
	readonly id: string
	readonly part: number
	readonly buffer: ArrayBuffer
}

export interface rangeItem {
	readonly start: number,
	readonly end: number,
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

export interface rtcRecv {
	id: string, // videoId
	sn: number,
	i: number, // 当前传输块序号
	n: number, // 共计多少块
	data: ArrayBuffer,
	t: number, //生成时间
}


export interface peerStat {
	tx: number
	rx: number
	state: RTCDataChannelState,
	cstate: RTCPeerConnectionState,
	istate: RTCIceConnectionState,
	gstate: RTCIceGatheringState,
	activetime: number,
	isServer: boolean,
	speed: number,
	hosts: hostsMap,
}


export interface resolveTask {
	id: string,
	sn: number,
	t: number
}



