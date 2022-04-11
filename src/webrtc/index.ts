import { fastConfig } from "../lib/types";
import libwebrtc from "./webrtc";

export default class extends libwebrtc {


	constructor(opts: fastConfig) {
		super(opts)
	}


	// 如果播放器已销毁,或跳转到其他页面,我们应广播我们之前所有的查询和resolve都作废
	clear() {
		// TODO quit
	}


	private quit(uid: string, id: string, part: number) {
		// TODO quit
	}


}
