## fastloadjs


> 多线程下载
> 
> 多源负载均衡下载
> 
> P2P下载
> 

一个混合了多线程,多源负载均衡,P2P下载,DASH解析引擎的下载器/播放器

### 编译前配置项

`yarn global add rollup typescript`

可配置 `src/fastload.ts` 中 `iceServers`

libwebrtc 修改 `ws server`

`make build` 完成编译


### 与 hlsp2p 的关系

hlsp2p 是对 m3u8(HLS 分片,按 URL 取 fragment)的 http+rtc 下载器,本项目是对 YouTube DASH(按 byte-range 取分块)的下载器/播放器。

#### 保持同步的文件(改动需互相同步)

| 本项目 | hlsp2p | 同步方式 |
| --- | --- | --- |
| `src/util/event.ts` | `src/util/event.ts` | hlsp2p 版 + 本项目追加 trigger 监听器异常隔离(单回调抛错不中断其他回调,hlsp2p 侧建议同步此改进) |
| `src/util/fnv1a.ts` | `src/util/fnv1a.ts` | 原样一致 |
| `src/util/bufferCenter.ts` | `src/util/bufferCenter.ts` | 原样一致 |
| `src/util/util.ts` | `src/util/util.ts` | hlsp2p 版 + 本项目追加 `asyncQueue`(buffer 写入队列) |
| `src/util/ws.ts` | `src/util/ws.ts` | hlsp2p 版 + 本项目追加一行 send 参数类型断言(新版 tsc 要求) |
| `src/lib/webrtc/util.ts` | `src/lib/webrtc/util.ts` | 原样一致 |
| `src/lib/webrtc/peer.ts` | `src/lib/webrtc/peer.ts` | hlsp2p 版 + 本项目将 `config` 类型改为 `rtcConfig`(构造参数只收 tracker/rtcConf) |
| `src/lib/webrtc/index.ts` | `src/lib/webrtc/index.ts` | hlsp2p 版 + 多 swarm 改造:`req(id, parts)`、`resolving` 按 `id:sn` 记录、`buffered` 可选、暴露 `id` getter |

本项目专属(不同步):`src/fetcher`(videoproxy `/start-end.ts` URL 改写 + Range 重试)、`src/tasks`、`src/workers`、`src/dispatcher`、`src/fastload.ts`、`src/buffer.ts`、`src/index.ts`、`src/types.ts`(融合版类型)、`src/mediaparse`。

#### 同步检查命令

```sh
difft src/util/event.ts ../../hlsp2p/src/util/event.ts
difft src/util/fnv1a.ts ../../hlsp2p/src/util/fnv1a.ts
difft src/util/bufferCenter.ts ../../hlsp2p/src/util/bufferCenter.ts
difft src/util/util.ts ../../hlsp2p/src/util/util.ts
difft src/util/ws.ts ../../hlsp2p/src/util/ws.ts
difft src/lib/webrtc/util.ts ../../hlsp2p/src/lib/webrtc/util.ts
difft src/lib/webrtc/peer.ts ../../hlsp2p/src/lib/webrtc/peer.ts
difft src/lib/webrtc/index.ts ../../hlsp2p/src/lib/webrtc/index.ts
```

除 `index.ts` 应只差异出多 swarm 改造、`util.ts` 应只差异出 `asyncQueue`、`ws.ts`/`peer.ts` 应只差异出上表所列小改动外,其余出现差异都说明某一方更新了,需要手动同步。

`fetcher/tasks/workers` 与 hlsp2p 的 `lib/fetcher`、`lib/providers` 是两个模型(本项目 byte-range,hlsp2p 整段 fragment URL),不做对比。

### 运行示例

根目录 `index.html` 是开发示例(`make dev`),`demo/index.html` 是线上构建产物示例。
