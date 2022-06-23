import mitt, { Emitter } from "https://esm.sh/mitt@3.0.0";
import { relative } from "https://deno.land/std@0.144.0/path/mod.ts";
import { watchFs } from "../lib/fs.ts";
import log from "../lib/log.ts";
import { initRoutes, toRouteRegExp } from "./routing.ts";
import type { DependencyGraph } from "./graph.ts";
import type { AlephConfig } from "./types.ts";

type FsEvents = {
  [key in "create" | "remove" | "transform" | `modify:${string}` | `hotUpdate:${string}`]: {
    specifier: string;
    status?: "success" | "failure";
    sourceCode?: string;
    error?: {
      message: string;
      stack: string;
      location?: [number, number];
    };
  };
};

const emitters = new Set<Emitter<FsEvents>>();

export function createFsEmitter() {
  const e = mitt<FsEvents>();
  emitters.add(e);
  return e;
}

export function removeFsEmitter(e: Emitter<FsEvents>) {
  e.all.clear();
  emitters.delete(e);
}

export function watchFS(cwd = Deno.cwd()) {
  log.info(`Watching files for changes...`);

  // update routes when fs change
  const emitter = createFsEmitter();
  const updateRoutes = async ({ specifier }: { specifier: string }) => {
    const config: AlephConfig | undefined = Reflect.get(globalThis, "__ALEPH_CONFIG");
    const rc = config?.routes;
    if (rc) {
      const reg = toRouteRegExp(rc);
      if (reg.test(specifier)) {
        const routeConfig = await initRoutes(reg);
        Reflect.set(globalThis, "__ALEPH_ROUTE_CONFIG", routeConfig);
      }
    } else {
      Reflect.set(globalThis, "__ALEPH_ROUTE_CONFIG", null);
    }
  };
  emitter.on("create", updateRoutes);
  emitter.on("remove", updateRoutes);

  watchFs(cwd, (kind, path) => {
    const specifier = "./" + relative(cwd, path).replaceAll("\\", "/");
    const clientDependencyGraph: DependencyGraph | undefined = Reflect.get(globalThis, "__ALEPH_CLIENT_DEP_GRAPH");
    const serverDependencyGraph: DependencyGraph | undefined = Reflect.get(globalThis, "__ALEPH_SERVER_DEP_GRAPH");
    if (kind === "remove") {
      clientDependencyGraph?.unmark(specifier);
      serverDependencyGraph?.unmark(specifier);
    } else {
      clientDependencyGraph?.update(specifier);
      serverDependencyGraph?.update(specifier);
    }
    if (specifier === "./index.html") {
      Reflect.deleteProperty(globalThis, "__ALEPH_INDEX_HTML");
    }

    if (kind === "modify") {
      emitters.forEach((e) => {
        e.emit(`modify:${specifier}`, { specifier });
        if (e.all.has(`hotUpdate:${specifier}`)) {
          e.emit(`hotUpdate:${specifier}`, { specifier });
        } else if (specifier !== "./routes.gen.ts") {
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
    }
  });
}
