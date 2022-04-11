## fastloadjs


> 多线程下载
> 
> 多源负载均衡下载
> 
> P2P下载
> 

一个混合了多线程,多源负载均衡,P2P下载,DASH解析引擎的下载器/播放器

### 编译前配置项

可配置 `lib/fastload.ts` 中 `iceServers`

libwebrtc 修改 `ws server`

`make build` 完成编译


进一步优化P2P

批量查询、回复

滑动窗口算法

自己记录回应过的peer

废弃中途取消



const iceServers = {
	"iceServers": [
		{
			urls: "stun:119.29.1.39:3478",
		},
		{
			urls: "turn:119.29.1.39:3478",
			username: "su",
			credential: "su"
		},
	]
};
