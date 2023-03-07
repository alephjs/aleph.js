import { isFilledArray } from "../shared/util.ts";
import { path, serve as stdServe, serveTls } from "./deps.ts";
import depGraph from "./graph.ts";
import { createHandler } from "./handler.ts";
import log, { type LevelName } from "./log.ts";
import { build } from "./build.ts";
import type { AlephConfig, ServeInit } from "./types.ts";
import { watch } from "./dev.ts";

/** The options for the Aleph.js server.  */
export type ServeOptions = AlephConfig & Omit<ServeInit, "onError">;

/** Start the Aleph.js server. */
export async function serve(options?: ServeOptions): Promise<void> {
  const isDev = Deno.args.includes("--dev");
  const { hostname, port, signal, onListen: _onListen, tls, plugins, ...config } = options ?? {};
  const { baseUrl, router } = config;

  // setup plugins
  if (plugins) {
    for (const plugin of plugins) {
      try {
        await plugin.setup(config);
        log.debug(`plugin ${plugin.name ?? "Unnamed"} setup`);
      } catch (err) {
        log.fatal(`[plugin:${plugin.name}] ${err.message}`);
      }
    }
  }

  // inject the config to global
  Reflect.set(globalThis, "__ALEPH_CONFIG", config);

  // use `_export.ts` imports
  if (router && router.routes) {
    if (isDev) {
      router.routes = undefined;
    } else if (isFilledArray(router.routes.depGraph?.modules)) {
      // restore the dependency graph from the re-import route modules
      router.routes.depGraph.modules.forEach((module) => {
        depGraph.mark(module.specifier, module);
      });
    }
  }

  const appDir = baseUrl ? path.fromFileUrl(new URL(".", baseUrl)) : Deno.cwd();
  const handler = createHandler(appDir, config);

  // build the app for production
  if (Deno.args.includes("--build")) {
    return build(appDir, handler);
  }

  // watch file changes in development mode
  if (isDev) {
    watch(appDir, Deno.args.includes("--generate"));
  }

  const onListen = (arg: { port: number; hostname: string }) => {
    const origin = `${tls ? "https" : "http"}://${hostname ?? "localhost"}:${arg.port}`;
    Reflect.set(globalThis, "__ALEPH_SERVER_ORIGIN", origin);
    log.info(`Server ready on ${origin}`);
    _onListen?.(arg);
  };
  const serveOptions = { hostname, port, signal, onListen };
  const flagPort = Number(Deno.args.join(" ").match(/--port=(\d+)/)?.[1]);
  if (flagPort) {
    serveOptions.port = flagPort;
  }
  if (tls) {
    return serveTls(handler, { ...tls, ...serveOptions });
  }
  return stdServe(handler, serveOptions);
}

/** Set the log level. */
export function setLogLevel(level: LevelName) {
  log.setLevel(level);
}

// set log level to debug when debug aleph.js itself.
if (import.meta.url.startsWith("file:")) {
  log.setLevel("debug");
}
