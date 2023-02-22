import type { Router } from "../runtime/core/routes.ts";
import { isFilledArray } from "../shared/util.ts";
import { fromFileUrl, serve as stdServe, serveTls } from "./deps.ts";
import depGraph from "./graph.ts";
import { getDeploymentId, globalIt } from "./helpers.ts";
import { createHandler } from "./handler.ts";
import log, { type LevelName } from "./log.ts";
import { importRouteModule } from "./routing.ts";
import { build } from "./build.ts";
import type { AlephConfig, ErrorHandler, ServeInit } from "./types.ts";
import { watch } from "./dev.ts";

/** The options for the Aleph.js server.  */
export type ServerOptions = AlephConfig & Omit<ServeInit, "onError"> & {
  certFile?: string;
  keyFile?: string;
  onError?: ErrorHandler;
};

/** Start the Aleph.js server. */
export function serve(options: ServerOptions = {}) {
  const buildMode = Deno.args.includes("--build") || Deno.args.includes("-O");
  const isDev = Deno.args.includes("--dev");
  const shouldGenerateExportTs = Deno.args.includes("--generate");
  const { baseUrl, loaders, middlewares, build: buildOptions, router: router, session, ssr, atomicCSS } = options;
  const { hostname, certFile, keyFile, signal } = options;
  const config: AlephConfig = { baseUrl, build: buildOptions, loaders, middlewares, router, session, ssr, atomicCSS };
  const appDir = baseUrl ? fromFileUrl(new URL(".", baseUrl)) : Deno.cwd();
  const handler = createHandler(options);

  // force to use the server port in env vars if exists
  if (Deno.env.get("ALEPH_SERVER_PORT")) {
    options.port = parseInt(Deno.env.get("ALEPH_SERVER_PORT")!);
  }

  // check `_export.ts` imports
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

  // set log level to debug when debug aleph.js itself.
  if (import.meta.url.startsWith("file:")) {
    log.setLevel("debug");
  }

  // inject the config to global
  Reflect.set(globalThis, "__ALEPH_CONFIG", config);

  // build the app for production
  if (buildMode) {
    build(handler, config, appDir);
    return;
  }

  // watch file changes in development mode
  if (isDev) {
    watch(appDir, shouldGenerateExportTs);
  }

  const onListen = (arg: { port: number; hostname: string }) => {
    if (!getDeploymentId()) {
      const protocol = certFile && keyFile ? "https" : "http";
      Deno.env.set("ALEPH_SERVER_ORIGIN", `${protocol}://${hostname ?? "localhost"}:${arg.port}`);
      log.info(`Server ready on ${protocol}://${hostname ?? "localhost"}:${arg.port}`);
    }
    options.onListen?.(arg);
  };
  if (certFile && keyFile) {
    serveTls(handler, { hostname, port: options.port, certFile, keyFile, signal, onListen });
  } else {
    stdServe(handler, { hostname, port: options.port, signal, onListen });
  }
}

/** Set the log level. */
export function setLogLeavel(level: LevelName) {
  log.setLevel(level);
}

// inject the `__aleph` global variable
Reflect.set(globalIt, "__aleph", {
  getRouteModule: () => {
    throw new Error("only available in client-side");
  },
  importRouteModule: async (filename: string) => {
    let router: Router | Promise<Router> | undefined = Reflect.get(globalThis, "__ALEPH_ROUTER");
    if (router) {
      if (router instanceof Promise) {
        router = await router;
      }
      const route = router.routes.find(([, meta]) => meta.filename === filename);
      if (route) {
        return importRouteModule(route[1]);
      }
    }
    return importRouteModule({ filename, pattern: { pathname: "" } });
  },
});
