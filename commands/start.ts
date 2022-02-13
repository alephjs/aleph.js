import { resolve } from "https://deno.land/std@0.125.0/path/mod.ts";
import { serve as stdServe, serveTls } from "https://deno.land/std@0.125.0/http/server.ts";
import { getFlag, parse, parsePortNumber } from "../lib/flags.ts";
import { existsDir, findFile } from "../lib/fs.ts";
import log from "../lib/log.ts";
import { proxyProject } from "../server/transformer.ts";

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
    -r, --reload                 Reload source code cache
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
  const certFile = getFlag(options, ["tls-cert"]);
  const keyFile = getFlag(options, ["tls-key"]);
  if (keyFile !== undefined && certFile === undefined) {
    log.fatal("missing `--tls-cert` option");
  } else if (certFile !== undefined && keyFile === undefined) {
    log.fatal("missing `--tls-key` option");
  }

  proxyProject(workingDir, 6060);
  log.debug(`Proxy project on http://localhost:6060`);

  const serverEntry = await findFile(Deno.cwd(), [
    "server.tsx",
    "server.jsx",
    "server.ts",
    "server.js",
  ]);
  if (serverEntry) {
    await import(serverEntry);
    const serverHandler: any = (globalThis as any).__ALEPH_SERVER_HANDLER;
    log.info(`Server ready on http://localhost:${port}`);
    if (certFile && keyFile) {
      await serveTls((req) => serverHandler(req, Deno.env.toObject()), { port, hostname, certFile, keyFile });
    } else {
      await stdServe((req) => serverHandler(req, Deno.env.toObject()), { port, hostname });
    }
  } else {
    log.fatal("No server entry found");
  }
}
