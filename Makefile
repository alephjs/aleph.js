test:
	deno test -A --location=http://localhost --import-map=import_map.json
dev_react_app:
	ALEPH_DEV=true deno run -A cli.ts dev ./examples/react-app -L debug
start_react_app:
	ALEPH_DEV=true deno run -A cli.ts start ./examples/react-app -L debug
build_react_app:
	ALEPH_DEV=true deno run -A cli.ts build ./examples/react-app -L debug
