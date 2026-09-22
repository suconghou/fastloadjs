## fastloadjs


> 多线程下载
>
> 多源负载均衡下载
>
> P2P下载

一个混合了多线程、多源负载均衡、P2P下载、DASH解析引擎的下载器/播放器。

按 byte-range 切分媒体分块,下载后直接写入 MediaSource 的 SourceBuffer 播放,支持 mp4(sidx 索引)与 webm(EBML Cues 索引)。

### 构建

```sh
yarn global add rollup typescript esbuild
make build
```

`tsc` 编译 → `rollup` 打包成 UMD → `esbuild` 压缩,产出单文件 `fastload.min.js`(全局名 `fastloadjs`,约 38KB),可直接 `<script>` 引入。

`make dev` 起本地静态服务器(`http://localhost:8080`)调试根目录 `index.html`,读取的是未压缩的 `bundle.js`,便于断点。

### 快速开始

```html
<script src="/bundle.js"></script>
<script>
    const loader = new fastloadjs({
        thread: 2,
        wsize: 12,
        // 配置 tracker 后启用P2P,如 "wss://your.tracker/ws",留空则纯HTTP下载
        tracker: "",
        // 启用P2P时需要,ICE servers
        rtcConf: {
            iceServers: [{ urls: 'stun:stun.qq.com:3478' }]
        },
    })
    loader.listen("error", console.error)
    loader.attach(document.querySelector('#video'), [
        {
            req: "http://share.suconghou.cn/video/TQ2Ytc3g1Pw/160.mp4",
            meta: "TQ2Ytc3g1Pw:160",
            init: { start: 0, end: 709 },
            index: { start: 710, end: 1281 },
            mimeCodec: 'video/mp4; codecs="avc1.4d400c"',
        },
        {
            req: "http://share.suconghou.cn/video/TQ2Ytc3g1Pw/140.mp4",
            meta: "TQ2Ytc3g1Pw:140",
            init: { start: 0, end: 591 },
            index: { start: 592, end: 899 },
            mimeCodec: 'audio/mp4; codecs="mp4a.40.2"'
        }
    ])
</script>
```

`streams` 是一个数组,每路视频/音频流一项,播放器需要几路就传几路。

### 配置项

`new fastloadjs(config)` 的 `config`:

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `thread` | number | 每路流的并发下载线程数,默认 `2` |
| `wsize` | number | 预读窗口大小(分块数),buffer 越充足窗口越大,默认 `12` |
| `retry` | number | 单个分块下载失败的重试次数,默认 `5` |
| `tracker` | string | P2P 信令服务地址,如 `wss://your.tracker/ws`,留空为纯 HTTP 下载 |
| `rtcConf` | RTCConfiguration | WebRTC 配置,启用 P2P 时需提供 `iceServers` |

`streams` 每一项:

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `req` | string | 该路流的源 URL,必填 |
| `meta` | string | 流标识,需全局唯一,启用 P2P 时作为 swarmId,如 `vid:itag` |
| `init` | `{start,end}` | init segment 的 byte 范围(闭区间) |
| `index` | `{start,end}` | 索引数据的 byte 范围:mp4 为 sidx,webm 为 EBML Cues |
| `mimeCodec` | string | SourceBuffer 的 MIME,如 `video/mp4; codecs="avc1.4d400c"` |
| `len` | number | 文件总字节数,仅 webm 需要(mp4 由 sidx 自描述) |
| `mirrors` | string[] | 可选,该路流的镜像源,与源站做负载均衡与故障转移 |

### API

| 方法 | 说明 |
| --- | --- |
| `attach(video, streams)` | 绑定媒体元素并开始下载,attach 前应先 `listen('ready')`。重复 attach(切换播放源)会重建内部实例,但**保留已注册的监听器** |
| `start()` / `pause()` | 恢复 / 暂停所有路的下载 |
| `seekTo(time)` | 跳到指定播放位置(秒),重新定位下载窗口 |
| `setBufferHealth(sec)` | 告知下载器当前缓冲秒数,缓冲充足时自动降速让位 P2P |
| `destroy()` | 销毁全部线程、P2P 连接、SourceBuffer 与事件监听,可重复调用 |
| `listen(ev, fn)` / `remove(ev, fn)` | 事件监听与取消 |

### 事件

顶层实例触发:

| 事件 | 参数 | 说明 |
| --- | --- | --- |
| `ready` | `(loaders, dispatchs)` | 全部流解析完成,可以播放;`loaders` 是各路下载器,`dispatchs` 是各路分块表 |
| `error` | `(err)` | 致命错误,上层应显示错误页面并停止播放 |

各路 `loader`(由 `ready` 传出)额外触发,可用于打点统计:

| 事件 | 参数 | 说明 |
| --- | --- | --- |
| `http.start` / `http.done` | `taskItem` / `partResponse` | HTTP 分块下载开始 / 完成 |
| `rtc.start` / `rtc.done` | `taskItem` / `partResponse` | P2P 分块下载开始 / 完成 |
| `rtc.progress` | `{i,n,meta,part}` | P2P 分片传输进度 |
| `rtc.stat` | `(stat, id)` | peer 统计信息 |

```js
loader.listen('ready', (loaders, dispatchs) => {
    loaders.forEach(l => l.listen('http.done', res => console.log('done', res.no)))
})
```

### 关于 URL 改写

分块请求会把源 URL 中的扩展名改写成路径形式,例如:

```
http://example.com/video/160.mp4
        ↓ 下载某个分块(具体范围由 sidx/Cues 索引表决定)
http://example.com/video/160/0-1048575.ts
```

即 `${原名}/${start}-${end}.ts`,`end` 为闭区间末位。后端的 videoproxy 需要按此形式解析并返回对应 byte-range 的数据,镜像源同理。`mirrors` 与源站会按分块序号取余固定分流,失败时自动排除并重试其他源。

### 运行示例

根目录 `index.html` 是开发示例(`make dev`),`demo/index.html` 是线上构建产物示例。
