import { basename, relative, resolve } from "https://deno.land/std@0.125.0/path/mod.ts";
import { serve as stdServe, serveTls } from "https://deno.land/std@0.125.0/http/server.ts";
import mitt, { Emitter } from "https://esm.sh/mitt@3.0.0";
import { getFlag, parse, parsePortNumber } from "../lib/flags.ts";
import { existsDir, findFile, watchFs } from "../lib/fs.ts";
import { builtinModuleExts } from "../lib/helpers.ts";
import log, { blue } from "../lib/log.ts";
import util from "../lib/util.ts";
import { loadImportMap } from "../server/config.ts";
import { serve } from "../server/mod.ts";
import { initRoutes, toRouteRegExp } from "../server/routing.ts";
import type { DependencyGraph } from "../server/graph.ts";
import { serveAppModules } from "../server/transformer.ts";
import type { AlephConfig } from "../server/types.ts";

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
    -h, --help                   Prints help message
`;

type FsEvents = {
  [key in "create" | "remove" | `modify:${string}` | `hotUpdate:${string}`]: { specifier: string };
};

const emitters = new Set<Emitter<FsEvents>>();
const createEmitter = () => {
  const e = mitt<FsEvents>();
  emitters.add(e);
  return e;
};
const removeEmitter = (e: Emitter<FsEvents>) => {
  e.all.clear();
  emitters.delete(e);
};
const handleHMRSocket = (req: Request): Response => {
  const { socket, response } = Deno.upgradeWebSocket(req, {});
  const emitter = createEmitter();
  const send = (message: Record<string, unknown>) => {
    try {
      socket.send(JSON.stringify(message));
    } catch (err) {
      log.warn("socket.send:", err.message);
    }
  };
  socket.addEventListener("open", () => {
    emitter.on("create", ({ specifier }) => {
      const config: AlephConfig | undefined = Reflect.get(globalThis, "__ALEPH_SERVER_CONFIG");
      if (config && config.routeFiles) {
        const reg = toRouteRegExp(config.routeFiles);
        const routePattern = reg.exec(specifier);
        if (routePattern) {
          send({ type: "create", specifier, routePattern });
          return;
        }
      }
      send({ type: "create", specifier });
    });
    emitter.on("remove", ({ specifier }) => {
      emitter.off(`hotUpdate:${specifier}`);
      send({ type: "remove", specifier });
    });
  });
  socket.addEventListener("message", (e) => {
    if (util.isFilledString(e.data)) {
      try {
        const { type, specifier } = JSON.parse(e.data);
        if (type === "hotAccept" && util.isFilledString(specifier)) {
          emitter.on(`hotUpdate:${specifier}`, () => send({ type: "modify", specifier }));
        }
      } catch (_e) {
        log.error("invlid socket message:", e.data);
      }
    }
  });
  socket.addEventListener("close", () => {
    removeEmitter(emitter);
  });
  return response;
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

  const importMap = await loadImportMap();
  serveAppModules(6060, { importMap });

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
      emitters.forEach((e) => {
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
      emitters.forEach((e) => {
        e.emit(kind, { specifier });
      });
    }
  });

  const emitter = createEmitter();
  const [denoConfigFile, importMapFile, serverEntry] = await Promise.all([
    findFile(workingDir, ["deno.jsonc", "deno.json", "tsconfig.json"]),
    findFile(workingDir, ["import_map", "import-map", "importmap", "importMap"].map((v) => `${v}.json`)),
    findFile(workingDir, builtinModuleExts.map((ext) => `server.${ext}`)),
  ]);
  const importServerHandler = async (): Promise<void> => {
    if (serverEntry) {
      await import(
        `http://localhost:${Deno.env.get("ALEPH_APP_MODULES_PORT")}/${basename(serverEntry)}?t=${
          Date.now().toString(16)
        }`
      );
      log.info(`Server handler imported from ${blue(basename(serverEntry))}`);
    }
  };
  if (serverEntry) {
    emitter.on(`modify:./${basename(serverEntry)}`, importServerHandler);
    if (denoConfigFile) {
      emitter.on(`modify:./${basename(denoConfigFile)}`, importServerHandler);
    }
    if (importMapFile) {
      emitter.on(`modify:./${basename(importMapFile)}`, async () => {
        Object.assign(importMap, await loadImportMap());
        importServerHandler();
      });
    }
    await importServerHandler();
  }

  // make the default handler
  if (!Reflect.has(globalThis, "__ALEPH_SERVER_HANDLER")) {
    serve();
  }

  // update routes when fs change
  const updateRoutes = ({ specifier }: { specifier: string }) => {
    const config: AlephConfig | undefined = Reflect.get(globalThis, "__ALEPH_SERVER_CONFIG");
    if (config && config.routeFiles) {
      const reg = toRouteRegExp(config.routeFiles);
      if (reg.test(specifier)) {
        initRoutes(reg);
      }
    }
  };
  emitter.on("create", updateRoutes);
  emitter.on("remove", updateRoutes);

  // final server handler
  const handler = (req: Request) => {
    const { pathname } = new URL(req.url);

    // handle HMR sockets
    if (pathname === "/-/hmr") {
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
