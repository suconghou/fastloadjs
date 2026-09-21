# 依赖: yarn global add rollup typescript esbuild

# 构建单文件压缩版 fastload.min.js (UMD,全局名 fastloadjs)
# tsc 编译 -> rollup 打包 UMD -> esbuild 压缩
build:
	cd src && \
	tsc -t ESNext index.ts && \
	rollup index.js -o ../bundle.js -n fastloadjs -f umd
	esbuild bundle.js --minify --outfile=fastload.min.js

ts:
	cd src && \
	tsc -t ESNext index.ts

tsw:
	cd src && \
	tsc -w -t ESNext index.ts

# 起本地静态服务器调试根目录 index.html(读取 build 产出的 bundle.js)
dev: build
	python3 -m http.server 8080

clean:
	rm -f bundle.js fastload.min.js
