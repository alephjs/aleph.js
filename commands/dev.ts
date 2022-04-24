import { basename, relative } from "https://deno.land/std@0.136.0/path/mod.ts";
import mitt, { Emitter } from "https://esm.sh/mitt@3.0.0";
import { findFile, watchFs } from "../lib/fs.ts";
import { builtinModuleExts } from "../lib/helpers.ts";
import log, { blue } from "../lib/log.ts";
import util from "../lib/util.ts";
import { serve as httpServe } from "../lib/serve.ts";
import { initModuleLoaders, loadImportMap } from "../server/config.ts";
import { serve } from "../server/mod.ts";
import { initRoutes, toRouteRegExp } from "../server/routing.ts";
import type { DependencyGraph } from "../server/graph.ts";
import { proxyModules } from "../server/proxy_modules.ts";
import type { AlephConfig } from "../server/types.ts";

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
      const config: AlephConfig | undefined = Reflect.get(globalThis, "__ALEPH_CONFIG");
      if (config && config.routes) {
        const reg = toRouteRegExp(config.routes);
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
  // add envs
  Deno.env.set("ALEPH_CLI", "true");
  Deno.env.set("ALEPH_ENV", "development");

  // set log level to 'debug' when in aleph framework dev mode
  if (Deno.env.get("ALEPH_DEV")) {
    log.setLevel("debug");
  }

  // serve app modules
  const cwd = Deno.cwd();
  const importMap = await loadImportMap();
  const moduleLoaders = await initModuleLoaders(importMap);
  await proxyModules(6060, { importMap, moduleLoaders });

  log.info(`Watching files for changes...`);
  watchFs(cwd, (kind, path) => {
    const specifier = "./" + relative(cwd, path);
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
          serverDependencyGraph?.lookup(specifier, (specifier) => {
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
    findFile(["deno.jsonc", "deno.json", "tsconfig.json"]),
    findFile(["import_map", "import-map", "importmap", "importMap"].map((v) => `${v}.json`)),
    findFile(builtinModuleExts.map((ext) => `server.${ext}`)),
  ]);

  let ac: AbortController | null = null;
  const bs = async () => {
    if (ac) {
      ac.abort();
      log.info(`Restart server...`);
    }
    ac = new AbortController();
    await bootstrap(ac.signal, serverEntry);
  };

  // update routes when fs change
  const updateRoutes = async ({ specifier }: { specifier: string }) => {
    const config: AlephConfig | undefined = Reflect.get(globalThis, "__ALEPH_CONFIG");
    const rc = config?.routes;
    if (rc) {
      const reg = toRouteRegExp(rc);
      if (!specifier || reg.test(specifier)) {
        await initRoutes(reg);
      }
    }
  };
  emitter.on("create", updateRoutes);
  emitter.on("remove", updateRoutes);

  if (serverEntry) {
    emitter.on(`hotUpdate:./${basename(serverEntry)}`, bs);
    if (denoConfigFile) {
      emitter.on(`modify:./${basename(denoConfigFile)}`, bs);
    }
    if (importMapFile) {
      emitter.on(`modify:./${basename(importMapFile)}`, async () => {
        // update import maps for `proxyModules`
        Object.assign(importMap, await loadImportMap());
        bs();
      });
    }
  }
  await bs();
}

async function bootstrap(signal: AbortSignal, entry: string | undefined, forcePort?: number): Promise<void> {
  // delete previous server handler
  if (Reflect.has(globalThis, "__ALEPH_SERVER")) {
    Reflect.deleteProperty(globalThis, "__ALEPH_SERVER");
  }

  if (entry) {
    const entryName = basename(entry);
    await import(
      `http://localhost:${Deno.env.get("ALEPH_MODULES_PROXY_PORT")}/${entryName}?t=${Date.now().toString(16)}`
    );
    if (Deno.env.get("ALEPH_SERVER_ENTRY") !== entryName) {
      Deno.env.set("ALEPH_SERVER_ENTRY", entryName);
      log.info(`Bootstrap server from ${blue(entryName)}...`);
    }
  }
  // make the default handler
  if (!Reflect.has(globalThis, "__ALEPH_SERVER")) {
    serve();
  }

  const {
    port: userPort,
    hostname,
    certFile,
    keyFile,
    handler,
  } = Reflect.get(globalThis, "__ALEPH_SERVER") || {};
  const port = forcePort || userPort || 8080;

  try {
    await httpServe({
      port,
      hostname,
      certFile,
      keyFile,
      signal,
      onListenSuccess: (port) => log.info(`Server ready on http://localhost:${port}`),
      handler: (req: Request) => {
        const { pathname } = new URL(req.url);

        // handle HMR sockets
        if (pathname === "/-/hmr") {
          return handleHMRSocket(req);
        }

        return handler?.(req);
      },
    });
  } catch (error) {
    if (error instanceof Deno.errors.AddrInUse) {
      log.warn(`Port ${port} is in use, try ${port + 1}...`);
      await bootstrap(signal, entry, port + 1);
    } else {
      throw error;
    }
  }
}
