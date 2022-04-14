import { basename, join } from "https://deno.land/std@0.134.0/path/mod.ts";
import { serve as stdServe, serveTls } from "https://deno.land/std@0.134.0/http/server.ts";
import { getFlag, parse, parsePortNumber } from "../lib/flags.ts";
import { findFile } from "../lib/fs.ts";
import { builtinModuleExts } from "../lib/helpers.ts";
import log, { blue } from "../lib/log.ts";
import { initModuleLoaders, loadImportMap } from "../server/config.ts";
import { build } from "../server/build.ts";
import { serve } from "../server/mod.ts";
import { serveAppModules } from "../server/serve_modules.ts";

export const helpMessage = `
Usage:
    deno run -A https://deno.land/x/aleph/cli.ts start [...options]

Options:
    -p, --port      <port>       A port number to start the aleph.js app, default is 8080
        --hostname  <hostname>   The address at which the server is to be started
        --tls-cert  <cert-file>  The server certificate file
        --tls-key   <key-file>   The server public key file
    -L, --log-level <log-level>  Set log level [possible values: debug, info]
    -h, --help                   Prints help message
`;

if (import.meta.main) {
  const { options } = parse();
  const port = parsePortNumber(getFlag(options, ["p", "port"], "8080"));
  const hostname = getFlag(options, ["hostname"]);
  const certFile = getFlag(options, ["tls-cert"]);
  const keyFile = getFlag(options, ["tls-key"]);

  if (keyFile !== undefined && certFile === undefined) {
    log.fatal("missing `--tls-cert` option");
  } else if (certFile !== undefined && keyFile === undefined) {
    log.fatal("missing `--tls-key` option");
  }

  // serve app modules
  const ac = new AbortController();
  const importMap = await loadImportMap();
  const moduleLoaders = await initModuleLoaders(importMap);
  serveAppModules(6060, { importMap, moduleLoaders, signal: ac.signal });

  let serverEntry = await findFile(builtinModuleExts.map((ext) => `server.${ext}`));
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
  const { clientModules } = await build("deno-deploy", serverEntry);
  log.info(`${clientModules.size} client modules built`);

  // close the app modules server
  ac.abort();

  await import("file://" + join(Deno.cwd(), "dist/server.js"));
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
