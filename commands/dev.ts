import { basename, relative, resolve } from "https://deno.land/std@0.125.0/path/mod.ts";
import { serve as stdServe, serveTls } from "https://deno.land/std@0.125.0/http/server.ts";
import { EventEmitter } from "../framework/core/events.ts";
import { getFlag, parse, parsePortNumber } from "../lib/flags.ts";
import { existsDir, findFile, watchFs } from "../lib/fs.ts";
import { builtinModuleExts } from "../lib/path.ts";
import log from "../lib/log.ts";
import util from "../lib/util.ts";
import { serve } from "../server/mod.ts";
import { clientDependencyGraph, serveAppModules, serverDependencyGraph } from "../server/transformer.ts";

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

  Deno.env.set("ALEPH_ENV", "development");

  serveAppModules(6060);
  log.debug(`Serve app modules on http://localhost:${Deno.env.get("ALEPH_APP_MODULES_PORT")}`);

  /** create a fs watcher.  */
  const fsWatchListeners: EventEmitter[] = [];
  const createFSWatchListener = (): EventEmitter => {
    const e = new EventEmitter();
    fsWatchListeners.push(e);
    return e;
  };
  const removeFSWatchListener = (e: EventEmitter) => {
    e.removeAllListeners();
    const index = fsWatchListeners.indexOf(e);
    if (index > -1) {
      fsWatchListeners.splice(index, 1);
    }
  };
  watchFs(workingDir, (path, kind) => {
    const specifier = "./" + relative(workingDir, path);
    if (kind === "remove") {
      clientDependencyGraph.unmark(specifier);
      serverDependencyGraph.unmark(specifier);
    } else {
      clientDependencyGraph.update(specifier);
      serverDependencyGraph.update(specifier);
    }
    fsWatchListeners.forEach((e) => {
      e.emit(kind, specifier);
    });
    if (kind === "modify") {
      fsWatchListeners.forEach((e) => {
        e.emit(`modify:${specifier}`);
        // emit HMR event
        if (!e.emit(`hotUpdate:${specifier}`)) {
          clientDependencyGraph.lookup(specifier, (specifier) => {
            if (e.emit(`hotUpdate:${specifier}`)) {
              return false;
            }
          });
        }
      });
    }
  });
  log.info(`Watching files for changes...`);

  const fswListener = createFSWatchListener();
  const watchFile = async (filename: string) => {
    const stat = await Deno.lstat(filename);
    const evtName = `modify:./${basename(filename)}`;
    fswListener.removeAllListeners(evtName);
    fswListener.on(evtName, importServer);
    return stat.mtime?.getTime().toString(16) + "-" + stat.size.toString(16);
  };
  const importServer = async (): Promise<void> => {
    const cwd = Deno.cwd();
    const [denoConfigFile, importMapFile, serverEntry] = await Promise.all([
      findFile(cwd, ["deno.jsonc", "deno.json", "tsconfig.json"]),
      findFile(cwd, ["import_map", "import-map", "importmap", "importMap"].map((v) => `${v}.json`)),
      findFile(cwd, builtinModuleExts.map((ext) => `server.${ext}`)),
    ]);
    if (serverEntry) {
      let hash = await watchFile(serverEntry);
      if (denoConfigFile) {
        hash += "-" + await watchFile(denoConfigFile);
      }
      if (importMapFile) {
        hash += "-" + await watchFile(importMapFile);
      }
      await import(`http://localhost:${Deno.env.get("ALEPH_APP_MODULES_PORT")}${serverEntry}?hash=${hash}`);
      log.debug(`Import server handler from ${basename(serverEntry)}(${hash})`);
    }
  };
  importServer();

  // make the default handler
  if (!("__ALEPH_SERVER_HANDLER" in globalThis)) {
    serve();
  }

  const handler = (req: Request) => {
    const { pathname } = new URL(req.url);

    // handle HMR socket
    if (pathname === "/-/HMR") {
      const { socket, response } = Deno.upgradeWebSocket(req, {});
      const listener = createFSWatchListener();
      const send = (message: Record<string, unknown>) => {
        try {
          socket.send(JSON.stringify(message));
        } catch (err) {
          log.warn("socket.send:", err.message);
        }
      };
      socket.addEventListener("open", () => {
        listener.on("add", (specifier: string) => send({ type: "add", specifier }));
        listener.on("remove", (specifier: string) => {
          listener.removeAllListeners(`hotUpdate:${specifier}`);
          send({ type: "remove", specifier });
        });
      });
      socket.addEventListener("message", (e) => {
        if (util.isFilledString(e.data)) {
          try {
            const { type, specifier } = JSON.parse(e.data);
            if (type === "hotAccept" && util.isFilledString(specifier)) {
              listener.on(`hotUpdate:${specifier}`, () => send({ type: "modify", specifier }));
            }
          } catch (_e) {
            log.error("invlid socket message:", e.data);
          }
        }
      });
      socket.addEventListener("close", () => {
        removeFSWatchListener(listener);
      });
      return response;
    }

    // deno-lint-ignore ban-ts-comment
    // @ts-ignore
    return globalThis.__ALEPH_SERVER_HANDLER(req);
  };

  log.info(`Server ready on http://localhost:${port}`);
  if (certFile && keyFile) {
    await serveTls(handler, { port, hostname, certFile, keyFile });
  } else {
    await stdServe(handler, { port, hostname });
  }
}
