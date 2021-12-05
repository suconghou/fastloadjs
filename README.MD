## fastloadjs


> 多线程下载
> 
> 多源负载均衡下载
> 
> P2P下载
> 

一个混合了多线程,多源负载均衡,P2P下载,DASH解析引擎的下载器/播放器

子项目

1. WebRTC 多对多网络库 https://github.com/suconghou/libwebrtc
2. webm和mp4解析 https://github.com/suconghou/mediaparse


### 编译前配置项

`yarn global add rollup typescript`

可配置 `lib/fastload.ts` 中 `iceServers`

`make build` 完成编译

it works as a part of https://github.com/suconghou/u2web 

it fetch datas from 

> https://github.com/suconghou/videoproxy
>
> https://github.com/suconghou/u2worker
>
> ...

you can use it directly from cdn address

`https://cdn.jsdelivr.net/combine/npm/vue@2.6.11/dist/vue.min.js,npm/vue-router@3.1.6/dist/vue-router.min.js,npm/axios@0.19.2/dist/axios.min.js,gh/suconghou/assets@8a64290/fastload.min.js`

just like u2web does.

you can update `8a64290` to the latest hash shows in https://github.com/suconghou/assets/tree/lib

build it from source only if you want to update the `iceServers` which is hardcode in `lib/fastload.ts`

you need clone `https://github.com/suconghou/libwebrtc` and `https://github.com/suconghou/mediaparse`

update `src/lib/fastload.ts` and `src/media/segment.ts` import code to these repo

