import { basename, resolve } from "https://deno.land/std@0.125.0/path/mod.ts";
import { serve as stdServe, serveTls } from "https://deno.land/std@0.125.0/http/server.ts";
import { getFlag, parse, parsePortNumber } from "../lib/flags.ts";
import { existsDir, findFile } from "../lib/fs.ts";
import { builtinModuleExts } from "../lib/helpers.ts";
import log, { blue } from "../lib/log.ts";
import { loadImportMap } from "../server/config.ts";
import { build } from "../server/build.ts";
import { serve } from "../server/mod.ts";
import { serveAppModules } from "../server/transformer.ts";

export const helpMessage = `
Usage:
    aleph start <dir> [...options]

<dir> represents the directory of Aleph.js app,
if the <dir> is empty, the current directory will be used.

Options:
    -p, --port      <port>       A port number to start the aleph.js app, default is 8080
        --hostname  <hostname>   The address at which the server is to be started
        --tls-cert  <cert-file>  The server certificate file
        --tls-key   <key-file>   The server public key file
    -L, --log-level <log-level>  Set log level [possible values: debug, info]
    -h, --help                   Prints help message
`;

if (import.meta.main) {
  const { args, options } = parse();

  // check working dir
  const workingDir = resolve(String(args[0] || "."));
  if (!await existsDir(workingDir)) {
    log.fatal("No such directory:", workingDir);
  }
  Deno.chdir(workingDir);

  const port = parsePortNumber(getFlag(options, ["p", "port"], "8080"));
  const hostname = getFlag(options, ["hostname"]);

  let certFile = getFlag(options, ["tls-cert"]);
  let keyFile = getFlag(options, ["tls-key"]);
  if (keyFile !== undefined && certFile === undefined) {
    log.fatal("missing `--tls-cert` option");
  } else if (certFile !== undefined && keyFile === undefined) {
    log.fatal("missing `--tls-key` option");
  } else {
    certFile = await findFile(workingDir, ["cert.pem", "tls.cert", "tls.crt"]);
    keyFile = await findFile(workingDir, ["key.pem", "tls.key"]);
  }

  serveAppModules(6060, await loadImportMap());

  let serverEntry = await findFile(workingDir, builtinModuleExts.map((ext) => `server.${ext}`));
  if (serverEntry) {
    await import(
      `http://localhost:${Deno.env.get("ALEPH_APP_MODULES_PORT")}/${basename(serverEntry)}?t=${Date.now().toString(16)}`
    );
  }

  // make the default handler
  if (!Reflect.has(globalThis, "__ALEPH_SERVER_HANDLER")) {
    serverEntry = undefined;
    serve();
  }

  log.info("Building...");
  const { clientModules } = await build(workingDir, "deno-deploy", serverEntry);
  log.info(`${clientModules.size} client modules built`);

  await import(
    `http://localhost:${Deno.env.get("ALEPH_APP_MODULES_PORT")}/dist/server.js?t=${Date.now().toString(16)}`
  );
  log.info(`Server handler imported from ${blue("dist/server.js")}`);

  const handler = (req: Request) => {
    return Reflect.get(globalThis, "__ALEPH_SERVER_HANDLER")?.(req);
  };

  log.info(`Server ready on http://localhost:${port}`);
  if (certFile && keyFile) {
    await serveTls(handler, { port, hostname, certFile, keyFile });
  } else {
    await stdServe(handler, { port, hostname });
  }
}
