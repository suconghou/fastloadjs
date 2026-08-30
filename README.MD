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

共用的文件

lib/fetcher 所有
lib/webrtc 所有
lib/providers 所有
util 所有


cd /Users/suconghou/data/git/hlsp2p/src && fd -I -e js -X rm
cd /Users/suconghou/data/git/repo/fastloadjs/src && fd -I -e js -X rm

cd /Users/suconghou/data/git/repo/fastloadjs/

difft src/lib/fetcher ../../hlsp2p/src/lib/fetcher
difft src/lib/webrtc ../../hlsp2p/src/lib/webrtc
difft src/lib/providers ../../hlsp2p/src/lib/providers
difft src/util ../../hlsp2p/src/util

