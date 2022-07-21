import log from "../lib/log.ts";
import util from "../lib/util.ts";
import type { Emitter } from "./deps.ts";
import { mitt, relative } from "./deps.ts";
import depGraph from "./graph.ts";
import { getAlephConfig, watchFs } from "./helpers.ts";
import { generateRoutesExportModule, initRouter, toRouteRegExp } from "./routing.ts";
import type { AlephConfig } from "./types.ts";

type WatchFsEvents = {
  [key in "create" | "remove" | "modify" | `modify:${string}` | `hotUpdate:${string}`]: {
    specifier: string;
  };
};

const watchFsEmitters = new Set<Emitter<WatchFsEvents>>();

/** Create a `watchFs` emitter. */
export function createWatchFsEmitter() {
  const e = mitt<WatchFsEvents>();
  watchFsEmitters.add(e);
  return e;
}

/** Remove the emitter. */
export function removeWatchFsEmitter(e: Emitter<WatchFsEvents>) {
  e.all.clear();
  watchFsEmitters.delete(e);
}

/** Watch for file changes and listen the dev server. */
export function watch(appDir = Deno.cwd()) {
  const emitter = createWatchFsEmitter();

  emitter.on("*", async (kind, { specifier }) => {
    const config = getAlephConfig();
    if (config) {
      if (config.router) {
        if (kind === "create" || kind === "remove") {
          // reload router when fs changess
          const reg = toRouteRegExp(config.router);
          if (reg.test(specifier)) {
            const router = await initRouter(config.router, appDir);
            Reflect.set(globalThis, "__ALEPH_ROUTER", router);
            generateRoutesExportModule(router, config.loaders).catch((err) => log.error(err));
          }
        }
      } else {
        Reflect.set(globalThis, "__ALEPH_ROUTER", null);
      }
    }
  });

  const config = getAlephConfig();
  if (config?.router) {
    initRouter(config.router, appDir).then((router) => {
      Reflect.set(globalThis, "__ALEPH_ROUTER", router);
      generateRoutesExportModule(router, config.loaders).catch((err) => log.error(err));
    });
  } else {
    Reflect.set(globalThis, "__ALEPH_ROUTER", null);
  }

  log.info("[dev] Watching for file changes...");
  watchFs(appDir, (kind: "create" | "remove" | "modify", path: string) => {
    const specifier = "./" + relative(appDir, path).replaceAll("\\", "/");
    // delete global cached index html
    if (specifier === "./index.html") {
      Reflect.deleteProperty(globalThis, "__ALEPH_INDEX_HTML");
    }
    if (kind === "remove") {
      depGraph.unmark(specifier);
    } else {
      depGraph.update(specifier);
    }
    if (kind === "modify") {
      watchFsEmitters.forEach((e) => {
        e.emit("modify", { specifier });
        e.emit(`modify:${specifier}`, { specifier });
        if (e.all.has(`hotUpdate:${specifier}`)) {
          e.emit(`hotUpdate:${specifier}`, { specifier });
        } else if (specifier !== "./routes/_export.ts") {
          depGraph.lookup(specifier, (specifier) => {
            if (e.all.has(`hotUpdate:${specifier}`)) {
              e.emit(`hotUpdate:${specifier}`, { specifier });
              return false;
            }
          });
        }
      });
    } else {
      watchFsEmitters.forEach((e) => e.emit(kind, { specifier }));
    }
  });
}

export function handleHMR(req: Request): Response {
  const { socket, response } = Deno.upgradeWebSocket(req);
  const emitter = createWatchFsEmitter();
  const send = (message: Record<string, unknown>) => {
    try {
      socket.send(JSON.stringify(message));
    } catch (err) {
      log.warn("socket.send:", err.message);
    }
  };
  socket.addEventListener("close", () => {
    removeWatchFsEmitter(emitter);
  });
  socket.addEventListener("open", () => {
    emitter.on("create", ({ specifier }) => {
      const config: AlephConfig | undefined = Reflect.get(
        globalThis,
        "__ALEPH_CONFIG",
      );
      if (config?.router) {
        const reg = toRouteRegExp(config.router);
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
          emitter.on(`hotUpdate:${specifier}`, () => {
            send({ type: "modify", specifier });
          });
        }
      } catch (_e) {
        log.error("invlid socket message:", e.data);
      }
    }
  });
  return response;
}
