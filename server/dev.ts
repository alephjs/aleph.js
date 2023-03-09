import { isFilledString } from "../shared/util.ts";
import { colors, Emitter, ensureDir, mitt, parseDeps, path } from "./deps.ts";
import depGraph from "./graph.ts";
import { builtinModuleExts, existsFile, findFile, getAlephConfig, getImportMap, watchFs } from "./helpers.ts";
import log from "./log.ts";
import { initRouter, toRouterRegExp } from "./routing.ts";
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

/** Watch for file changes. */
export function watch(appDir: string, onRouterChange?: () => void) {
  const config = getAlephConfig();
  const emitter = createWatchFsEmitter();

  emitter.on("*", async (kind, { specifier }) => {
    if (kind === "create" || kind === "remove") {
      // reload router when fs changess
      const reg = toRouterRegExp(config?.router);
      if (reg.test(specifier)) {
        const router = await initRouter(config?.router, appDir);
        Reflect.set(globalThis, "__ALEPH_ROUTER", router);
        onRouterChange?.();
      }
    }
  });

  if (onRouterChange) {
    initRouter(config?.router, appDir).then((router) => {
      Reflect.set(globalThis, "__ALEPH_ROUTER", router);
      onRouterChange();
    });
  }

  watchFs(appDir, (kind: "create" | "remove" | "modify", pathname: string) => {
    const specifier = "./" + path.relative(appDir, pathname).replaceAll("\\", "/");
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

let devProcess: Deno.Process | null = null;
let watched = false;

export default async function dev(serverEntry?: string) {
  serverEntry = serverEntry
    ? serverEntry.startsWith("file://") ? path.fromFileUrl(serverEntry) : path.resolve(serverEntry)
    : await findFile(builtinModuleExts.map((ext) => `server.${ext}`), Deno.cwd());
  if (!serverEntry) {
    log.fatal("[dev] No server entry found.");
    return;
  }

  const appDir = path.dirname(serverEntry);
  if (!watched) {
    log.info(colors.dim("[dev]"), "Watching for file changes...");
    watch(appDir);
    watched = true;
  }

  const entry = `./${path.basename(serverEntry)}`;
  const code = await Deno.readTextFile(serverEntry);
  const importMap = await getImportMap();
  const deps = await parseDeps(entry, code, {
    importMap: JSON.stringify(importMap),
  });
  const exportTs = deps.find((dep) => dep.specifier.startsWith("./") && dep.specifier.endsWith("/_export.ts"));

  // ensure the `_export.ts` file exists
  if (exportTs) {
    const fp = path.join(appDir, exportTs.specifier);
    if (!(await existsFile(fp))) {
      await ensureDir(path.dirname(fp));
      await Deno.writeTextFile(fp, "export default {}");
    }
  }

  // watch server entry and its deps to restart the dev server
  const emitter = createWatchFsEmitter();
  emitter.on("*", (kind, { specifier }) => {
    if (
      kind === "modify" && !specifier.endsWith("/_export.ts") && (
        specifier === entry ||
        deps.some((dep) => dep.specifier === specifier)
      )
    ) {
      console.clear();
      console.info(colors.dim("[dev] Restarting the server..."));
      devProcess?.kill("SIGTERM");
      dev(serverEntry);
    }
  });

  const cmd = [Deno.execPath(), "run", "-A", "--no-lock", serverEntry, "--dev"];
  devProcess = Deno.run({ cmd, stderr: "inherit", stdout: "inherit", cwd: appDir });
  await devProcess.status();
  removeWatchFsEmitter(emitter);
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
        const reg = toRouterRegExp(config.router);
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
    if (isFilledString(e.data)) {
      try {
        const { type, specifier } = JSON.parse(e.data);
        if (type === "hotAccept" && isFilledString(specifier)) {
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
