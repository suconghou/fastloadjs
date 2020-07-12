build:
	make ts && \
	cd src && \
	rollup index.js -o ../bundle.js -n fastloadjs -f umd
tsw:
	cd src && \
	tsc -w -t ESNext index.ts
ts:
	cd src && \
	tsc -t ESNext index.ts
min:
	closurecompiler.sh  --js_output_file fastload.min.js --language_out ECMASCRIPT_2017 bundle.js
dev:
	parcel index.html
