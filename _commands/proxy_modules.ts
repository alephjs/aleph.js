import MagicString from "https://esm.sh/magic-string@0.26.2";
import { parseDeps } from "https://deno.land/x/aleph_compiler@0.6.6/mod.ts";
import log from "../lib/log.ts";
import { getContentType } from "../lib/media_type.ts";
import { serveDir } from "../lib/serve.ts";
import util from "../lib/util.ts";
import { bundleCSS } from "./bundle_css.ts";
import { DependencyGraph } from "./graph.ts";
import { builtinModuleExts } from "./helpers.ts";
import type { ImportMap, ModuleLoader, ModuleLoaderEnv, ModuleLoaderOutput } from "./types.ts";

const cssModuleLoader = async (specifier: string, env: ModuleLoaderEnv) => {
  const { code, cssModulesExports, deps } = await bundleCSS(
    specifier,
    await Deno.readTextFile(specifier),
    {
      // todo: support borwserslist
      targets: {
        android: 95,
        chrome: 95,
        edge: 95,
        firefox: 90,
        safari: 14,
      },
      minify: !env.isDev,
      cssModules: specifier.endsWith(".module.css"),
    },
  );
  const serverDependencyGraph: DependencyGraph | undefined = Reflect.get(globalThis, "__ALEPH_SERVER_DEP_GRAPH");
  if (!serverDependencyGraph) {
    throw new Error("The `serverDependencyGraph` is not defined");
  }
  serverDependencyGraph.mark(specifier, { deps: deps?.map((specifier) => ({ specifier })), inlineCSS: code });
  return {
    content: `export default ${JSON.stringify(cssModulesExports)};`,
    headers: [["Content-Type", "application/javascript; charset=utf-8"]],
  };
};

const esModuleLoader = async (input: { specifier: string } & ModuleLoaderOutput, env: ModuleLoaderEnv) => {
  const serverDependencyGraph: DependencyGraph | undefined = Reflect.get(globalThis, "__ALEPH_SERVER_DEP_GRAPH");
  if (!serverDependencyGraph) {
    throw new Error("The `serverDependencyGraph` is not defined");
  }

  const { code, specifier, lang, inlineCSS } = input;
  if (lang === "css") {
    throw new Error("The `lang` can't be `css`");
  }

  const deps = await parseDeps(specifier, code, { importMap: JSON.stringify(env.importMap), lang });
  const headers: HeadersInit = [];
  if (lang) {
    headers.push(["Content-Type", getContentType(`file.${lang}`)]);
    headers.push(["X-Language", lang]);
  }
  serverDependencyGraph.mark(specifier, { deps, inlineCSS });
  if (deps.length) {
    const s = new MagicString(code);
    deps.forEach((dep) => {
      const { specifier, importUrl, loc } = dep;
      if (loc) {
        let url = `"${importUrl}"`;
        if (!util.isLikelyHttpURL(specifier)) {
          const versionStr = serverDependencyGraph.get(specifier)?.version || serverDependencyGraph.globalVersion;
          if (importUrl.includes("?")) {
            url = `"${importUrl}&v=${versionStr}"`;
          } else {
            url = `"${importUrl}?v=${versionStr}"`;
          }
        }
        s.overwrite(loc.start - 1, loc.end - 1, url);
      }
    });
    return { content: s.toString(), headers };
  }
  return { content: code, headers };
};

function initLoader(moduleLoaders: ModuleLoader[], env: ModuleLoaderEnv) {
  return async (req: Request): Promise<{ content: string | Uint8Array; contentType?: string } | undefined> => {
    const { pathname } = new URL(req.url);
    const specifier = "." + pathname;
    if (pathname.endsWith(".css")) {
      return await cssModuleLoader(specifier, env);
    } else if (builtinModuleExts.findIndex((ext) => pathname.endsWith(`.${ext}`)) !== -1) {
      return await esModuleLoader({ specifier, code: await Deno.readTextFile(specifier) }, env);
    } else {
      const loader = moduleLoaders.find((loader) => loader.test(pathname));
      if (loader) {
        const ret = await loader.load(specifier, await Deno.readTextFile(specifier), env);
        return await esModuleLoader(Object.assign(ret, { specifier }), env);
      }
    }
  };
}

type ProxyModulesOptions = {
  moduleLoaders: ModuleLoader[];
  importMap: ImportMap;
  signal?: AbortSignal;
};

/** serve app modules to support module loader that allows you import Non-JavaScript modules like `.css/.vue/.svelet/...` */
export function proxyModules(port: number, options: ProxyModulesOptions) {
  Reflect.set(globalThis, "__ALEPH_SERVER_DEP_GRAPH", new DependencyGraph());
  return new Promise<void>((resolve, reject) => {
    serveDir({
      port,
      signal: options.signal,
      loader: initLoader(options.moduleLoaders, {
        importMap: options.importMap,
        isDev: Deno.env.get("ALEPH_ENV") === "development",
        ssr: true,
      }),
      onListenSuccess: (port) => {
        Deno.env.set("ALEPH_MODULES_PROXY_PORT", port.toString());
        log.info(`Proxy modules on http://localhost:${port}`);
        resolve();
      },
    }).catch((err) => {
      if (err instanceof Deno.errors.AddrInUse) {
        proxyModules(port + 1, options).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });
  });
}
