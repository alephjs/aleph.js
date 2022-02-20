import { basename, relative, resolve } from "https://deno.land/std@0.125.0/path/mod.ts";
import { serve as stdServe, serveTls } from "https://deno.land/std@0.125.0/http/server.ts";
import mitt, { Emitter } from "https://esm.sh/mitt@3.0.0";
import { getFlag, parse, parsePortNumber } from "../lib/flags.ts";
import { existsDir, findFile, watchFs } from "../lib/fs.ts";
import { builtinModuleExts } from "../lib/path.ts";
import log from "../lib/log.ts";
import util from "../lib/util.ts";
import { loadImportMap } from "../server/config.ts";
import { serve } from "../server/mod.ts";
import { initRoutes, toRoutingRegExp } from "../server/routing.ts";
import { type DependencyGraph } from "../server/graph.ts";
import { serveAppModules } from "../server/transformer.ts";
import { AlephConfig } from "../types.d.ts";

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

type FsEvents = {
  [key in "create" | "remove" | `modify:${string}` | `hotUpdate:${string}`]: { specifier: string };
};

const fswListeners = new Set<Emitter<FsEvents>>();
const createFSWListener = () => {
  const e = mitt<FsEvents>();
  fswListeners.add(e);
  return e;
};
const removeFSWListener = (e: Emitter<FsEvents>) => {
  e.all.clear();
  fswListeners.delete(e);
};

if (import.meta.main) {
  const { args, options } = parse();

  // check working dir
  const workingDir = resolve(String(args[0] || "."));
  if (!await existsDir(workingDir)) {
    log.fatal("No such directory:", workingDir);
  }
  Deno.chdir(workingDir);
  Deno.env.set("ALEPH_ENV", "development");

  const port = parsePortNumber(getFlag(options, ["p", "port"], "8080"));
  const hostname = getFlag(options, ["hostname"]);
  const certFile = getFlag(options, ["tls-cert"]);
  const keyFile = getFlag(options, ["tls-key"]);
  if (keyFile !== undefined && certFile === undefined) {
    log.fatal("missing `--tls-cert` option");
  } else if (certFile !== undefined && keyFile === undefined) {
    log.fatal("missing `--tls-key` option");
  }

  serveAppModules(6060, await loadImportMap());
  log.debug(`Serve app modules on http://localhost:${Deno.env.get("ALEPH_APP_MODULES_PORT")}`);

  log.info(`Watching files for changes...`);
  watchFs(workingDir, (kind, path) => {
    const specifier = "./" + relative(workingDir, path);
    const clientDependencyGraph: DependencyGraph | undefined = Reflect.get(globalThis, "clientDependencyGraph");
    const serverDependencyGraph: DependencyGraph | undefined = Reflect.get(globalThis, "serverDependencyGraph");
    if (kind === "remove") {
      clientDependencyGraph?.unmark(specifier);
      serverDependencyGraph?.unmark(specifier);
    } else {
      clientDependencyGraph?.update(specifier);
      serverDependencyGraph?.update(specifier);
    }
    if (kind === "modify") {
      fswListeners.forEach((e) => {
        e.emit(`modify:${specifier}`, { specifier });
        // emit HMR event
        if (e.all.has(`hotUpdate:${specifier}`)) {
          e.emit(`hotUpdate:${specifier}`, { specifier });
        } else {
          clientDependencyGraph?.lookup(specifier, (specifier) => {
            if (e.all.has(`hotUpdate:${specifier}`)) {
              e.emit(`hotUpdate:${specifier}`, { specifier });
              return false;
            }
          });
        }
      });
    } else {
      fswListeners.forEach((e) => {
        e.emit(kind, { specifier });
      });
    }
  });

  const fswListener = createFSWListener();
  const watchServerHandler = (filename: string) => {
    fswListener.off(`modify:./${basename(filename)}`);
    fswListener.on(`modify:./${basename(filename)}`, importServerHandler);
  };
  const importServerHandler = async (): Promise<void> => {
    const cwd = Deno.cwd();
    const [denoConfigFile, importMapFile, serverEntry] = await Promise.all([
      findFile(cwd, ["deno.jsonc", "deno.json", "tsconfig.json"]),
      findFile(cwd, ["import_map", "import-map", "importmap", "importMap"].map((v) => `${v}.json`)),
      findFile(cwd, builtinModuleExts.map((ext) => `server.${ext}`)),
    ]);
    if (serverEntry) {
      watchServerHandler(serverEntry);
      if (denoConfigFile) {
        watchServerHandler(denoConfigFile);
      }
      if (importMapFile) {
        watchServerHandler(importMapFile);
      }
      await import(
        `http://localhost:${Deno.env.get("ALEPH_APP_MODULES_PORT")}/${basename(serverEntry)}?t=${
          Date.now().toString(16)
        }`
      );
      log.info(`Server handler imported from ${basename(serverEntry)}`);
    }
  };
  await importServerHandler();

  // init routes when fs change
  const updateRoutes = ({ specifier }: { specifier: string }) => {
    const config: AlephConfig | undefined = Reflect.get(globalThis, "__ALEPH_CONFIG");
    if (config && config.routeFiles) {
      const reg = toRoutingRegExp(config.routeFiles);
      if (reg.test(specifier)) {
        initRoutes(reg);
      }
    }
  };
  fswListener.on("create", updateRoutes);
  fswListener.on("remove", updateRoutes);

  // make the default handler
  if (!Reflect.has(globalThis, "__ALEPH_SERVER_HANDLER")) {
    serve();
  }

  // final server handler
  const handler = (req: Request) => {
    const { pathname } = new URL(req.url);

    // handle HMR sockets
    if (pathname === "/-/HMR") {
      return handleHMRSocket(req);
    }

    return Reflect.get(globalThis, "__ALEPH_SERVER_HANDLER")?.(req);
  };

  log.info(`Server ready on http://localhost:${port}`);
  if (certFile && keyFile) {
    await serveTls(handler, { port, hostname, certFile, keyFile });
  } else {
    await stdServe(handler, { port, hostname });
  }
}

function handleHMRSocket(req: Request): Response {
  const { socket, response } = Deno.upgradeWebSocket(req, {});
  const listener = createFSWListener();
  const send = (message: Record<string, unknown>) => {
    try {
      socket.send(JSON.stringify(message));
    } catch (err) {
      log.warn("socket.send:", err.message);
    }
  };
  socket.addEventListener("open", () => {
    listener.on("create", ({ specifier }) => {
      const config: AlephConfig | undefined = Reflect.get(globalThis, "__ALEPH_CONFIG");
      if (config && config.routeFiles) {
        const reg = toRoutingRegExp(config.routeFiles);
        const pattern = reg.exec(specifier);
        if (pattern) {
          send({ type: "create", specifier, routePattern: pattern });
          return;
        }
      }
      send({ type: "create", specifier });
    });
    listener.on("remove", ({ specifier }) => {
      listener.off(`hotUpdate:${specifier}`);
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
    removeFSWListener(listener);
  });
  return response;
}
