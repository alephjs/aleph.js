test:
	deno test -A --location=http://localhost --import-map=import_map.json
dev:
	ALEPH_DEV=true deno run -A cli.ts dev ./examples/${example} -L debug
start:
	ALEPH_DEV=true deno run -A cli.ts start ./examples/${example} -L debug
build:
	ALEPH_DEV=true deno run -A cli.ts build ./examples/${example} -L debug
build_wasm:
	deno run -A compiler/build.ts