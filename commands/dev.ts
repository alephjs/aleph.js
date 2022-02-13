import { basename, extname, globToRegExp, join, resolve } from "https://deno.land/std@0.125.0/path/mod.ts";
import { serve as stdServe, serveTls } from "https://deno.land/std@0.125.0/http/server.ts";
import { getFlag, parse, parsePortNumber } from "../lib/flags.ts";
import { existsDir, findFile } from "../lib/fs.ts";
import log, { dim } from "../lib/log.ts";
import util from "../lib/util.ts";
import { proxyProject } from "../server/transformer.ts";

export const helpMessage = `
Usage:
    aleph dev <dir> [...options]

<dir> represents the directory of Aleph.js app,
if the <dir> is empty, the current directory will be used.

Options:
    -p, --port      <port>       A port number to start the Aleph.js app, default is 8080
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

  const serverEntry = await findFile(Deno.cwd(), ["server.tsx", "server.jsx", "server.ts", "server.js"]);
  if (serverEntry) {
    const global = globalThis as any;
    Deno.env.set("ALEPH_ENV", "development");
    Deno.env.set("ALEPH_BUILD_ID", Date.now().toString(16));
    await import(
      `http://localhost:${Deno.env.get("ALEPH_BUILD_PORT")}/${basename(serverEntry)}?BUILD=${
        Deno.env.get("ALEPH_BUILD_ID")
      }`
    );
    const serverHandler = global.__ALEPH_SERVER_HANDLER;
    if (global.__ALEPH_ROUTES_GLOB) {
      global.__ALEPH_ROUTES = await readRoutes(global.__ALEPH_ROUTES_GLOB);
    }
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

async function readRoutes(glob: string) {
  const reg = globToRegExp(glob);
  const files = await getFiles(Deno.cwd(), (filename) => reg.test(filename));
  const ppPort = Deno.env.get("ALEPH_BUILD_PORT");
  return Promise.all(files.map(async (filename) => {
    const [prefix] = glob.split("*");
    const p = "/" + util.splitPath(util.trimPrefix(filename, util.trimSuffix(prefix, "/"))).map((part) => {
      part = part.toLowerCase();
      if (part.startsWith("[") && part.startsWith("]")) {
        return ":" + part.slice(1, -1);
      } else if (part.startsWith("$")) {
        return ":" + part.slice(1);
      }
      return part;
    }).join("/");
    const pathname = util.trimSuffix(util.trimSuffix(p, extname(p)), "/index") || "/";
    const importUrl = `http://localhost:${ppPort}${filename.slice(1)}`;
    log.debug(dim("[route]"), pathname);
    return [
      // @ts-ignore
      new URLPattern({ pathname }),
      async () => {
        const mod = await import(`${importUrl}?BUILD=${Deno.env.get("ALEPH_BUILD_ID")}`);
        return {
          component: mod.default,
          data: mod.data,
        };
      },
    ];
  }));
}

async function getFiles(dir: string, filter?: (filename: string) => boolean, path: string[] = []): Promise<string[]> {
  const list: string[] = [];
  for await (const dirEntry of Deno.readDir(dir)) {
    if (dirEntry.isDirectory) {
      list.push(...await getFiles(join(dir, dirEntry.name), filter, [...path, dirEntry.name]));
    } else {
      const filename = [".", ...path, dirEntry.name].join("/");
      if (!filter || filter(filename)) {
        list.push(filename);
      }
    }
  }
  return list;
}
