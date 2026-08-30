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

// 构造实际请求,videoproxy通过 /start-end.ts 形式的URL获取range数据
export interface requestBuilder {
	(req: string, start: number, end: number): Request;
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
	id: string, // swarmId,即 streamItem.meta
	sn: number,
	i: number, // 当前传输块序号
	n: number, // 共计多少块
	data: ArrayBuffer,
	t: number, //生成时间
}


// p2p分片查询,兼容hlsp2p的fragment: url仅在服务端peer回复hosts时可能附带,本项目中不需要
export interface fragment {
	readonly url?: string,
	readonly sn: number,
}


export interface rtcConfig {
	readonly tracker: string
	readonly rtcConf: RTCConfiguration,
	// 当前已缓冲秒数,用于调节p2p重试等待,可不传
	readonly buffered?: () => number
}


export interface rtcBufferItem {
	data: bufferItem
	newly: boolean,
	server: boolean,
	id: string // 对端UID
}


export interface rtcProgressInfo {
	id: string // 对端UID
	data: rtcRecv
}


export interface rtcParts {
	id: string,
	parts: Array<number>
}


export interface rtcReqRet {
	unresolved: Array<fragment>
	guessed: Array<fragment>
	unresolved_retry: Array<fragment>
	guessed_retry: Array<fragment>
	guessed_eachother: Array<fragment>
}


export interface resolvingInfo {
	t: number,
	uid: string
	guess: boolean
	id: string
	sn: number
}


export interface peerStat {
	tx: number
	rx: number
	state: RTCDataChannelState | null,
	cstate: RTCPeerConnectionState | null,
	istate: RTCIceConnectionState | null,
	gstate: RTCIceGatheringState | null,
	bufferedAmount: number,
	createtime: number,
	activetime: number,
	isServer: boolean,
	speed: number,
	hosts: hostsMap,
	localAddress: string | null,
	localPort: number | null,
	remoteAddress: string | null,
	remotePort: number | null,
	relay: boolean,
	relatedAddress: string | null,
	relatedPort: number | null,
	packet: number,
	resolveParts: number,
	responseParts: number,
}


export interface resolveTask {
	id: string,
	sn: number,
	t: number
}
