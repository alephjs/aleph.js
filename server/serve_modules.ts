import { createGenerator } from "https://esm.sh/@unocss/core@0.30.12";
import MagicString from "https://esm.sh/magic-string@0.26.1";
import { parseDeps } from "../compiler/mod.ts";
import { builtinModuleExts } from "../lib/helpers.ts";
import log from "../lib/log.ts";
import { getContentType } from "../lib/mime.ts";
import { serveDir } from "../lib/serve.ts";
import util from "../lib/util.ts";
import { bundleCSS } from "./bundle_css.ts";
import { DependencyGraph } from "./graph.ts";
import type { AlephConfig, ImportMap, ModuleLoader, ModuleLoaderContent, ModuleLoaderEnv } from "./types.ts";

const cssModuleLoader = async (pathname: string, env: ModuleLoaderEnv) => {
  const specifier = "." + pathname;
  const { code, cssModulesExports, deps } = await bundleCSS(
    specifier,
    await Deno.readTextFile(specifier),
    {
      targets: {
        android: 95,
        chrome: 95,
        edge: 95,
        firefox: 90,
        safari: 14,
      },
      minify: !env.isDev,
      cssModules: pathname.endsWith(".module.css"),
    },
  );
  const serverDependencyGraph: DependencyGraph | undefined = Reflect.get(globalThis, "serverDependencyGraph");
  if (serverDependencyGraph) {
    serverDependencyGraph.mark(specifier, { deps: deps?.map((specifier) => ({ specifier })), inlineCSS: code });
  }
  return {
    content: `export default ${JSON.stringify(cssModulesExports)};`,
    contentType: "application/javascript; charset=utf-8",
  };
};

const esModuleLoader = async (input: { pathname: string } & ModuleLoaderContent, env: ModuleLoaderEnv) => {
  const { code: rawCode, pathname, lang } = input;
  const config: AlephConfig | undefined = Reflect.get(globalThis, "__ALEPH_SERVER_CONFIG");
  const specifier = "." + pathname;
  const isJSX = lang === "tsx" || lang === "jsx" || pathname.endsWith(".jsx") || pathname.endsWith(".tsx");
  const contentType = lang ? getContentType(`file.${lang}`) : undefined;
  const serverDependencyGraph: DependencyGraph | undefined = Reflect.get(globalThis, "serverDependencyGraph");
  if (serverDependencyGraph) {
    let inlineCSS = input.inlineCSS;
    if (Boolean(config?.atomicCSS?.presets?.length) && isJSX) {
      const uno = createGenerator(config?.atomicCSS);
      const { css } = await uno.generate(rawCode, {
        id: specifier,
        minify: !env.isDev,
      });
      if (css) {
        if (inlineCSS) {
          inlineCSS = `${inlineCSS}\n${css}`;
        } else {
          inlineCSS = css;
        }
      }
    }
    const deps = await parseDeps(specifier, rawCode, { importMap: JSON.stringify(env.importMap) });
    serverDependencyGraph.mark(specifier, { deps, inlineCSS });
    const locDeps = deps.filter((dep) => !util.isLikelyHttpURL(dep.specifier));
    if (locDeps.length) {
      const s = new MagicString(rawCode);
      locDeps.forEach((dep) => {
        const { specifier, importUrl, loc } = dep;
        if (loc) {
          const versionStr = serverDependencyGraph.get(specifier)?.version || serverDependencyGraph.initialVersion;
          let url = importUrl;
          if (url.includes("?")) {
            url = `"${url}&v=${versionStr}"`;
          } else {
            url = `"${url}?v=${versionStr}"`;
          }
          s.overwrite(loc.start, loc.end, url);
        }
      });
      return { content: s.toString(), contentType };
    }
    return {
      content: rawCode,
      contentType,
    };
  }
  return {
    content: rawCode,
    contentType,
  };
};

const initLoader = (moduleLoaders: ModuleLoader[], env: ModuleLoaderEnv) => {
  return async (req: Request): Promise<{ content: string | Uint8Array; contentType?: string } | undefined> => {
    const { pathname } = new URL(req.url);
    if (pathname.endsWith(".css")) {
      return await cssModuleLoader(pathname, env);
    } else if (builtinModuleExts.findIndex((ext) => pathname.endsWith(`.${ext}`)) !== -1) {
      return await esModuleLoader({ pathname, code: await Deno.readTextFile(`.${pathname}`) }, env);
    } else {
      const loader = moduleLoaders.find((loader) => loader.test(pathname));
      if (loader) {
        let ret = loader.load(pathname, env);
        if (ret instanceof Promise) {
          ret = await ret;
        }
        return await esModuleLoader({ pathname, ...ret }, env);
      }
    }
  };
};

type ServerOptions = {
  moduleLoaders: ModuleLoader[];
  importMap: ImportMap;
  signal?: AbortSignal;
};

/** serve app modules to support module loader that allows you import NON-JS modules like `.css/.vue/.svelet`... */
export async function serveAppModules(port: number, options: ServerOptions) {
  if (!Reflect.has(globalThis, "serverDependencyGraph")) {
    Reflect.set(globalThis, "serverDependencyGraph", new DependencyGraph());
  }
  Deno.env.set("ALEPH_APP_MODULES_PORT", port.toString());
  log.debug(`Serve app modules on http://localhost:${port}`);
  try {
    await serveDir({
      port,
      signal: options.signal,
      loader: initLoader(options.moduleLoaders, {
        importMap: options.importMap,
        isDev: Deno.env.get("ALEPH_ENV") === "development",
        ssr: true,
      }),
    });
  } catch (error) {
    if (error instanceof Deno.errors.AddrInUse) {
      serveAppModules(port + 1, options);
    } else {
      throw error;
    }
  }
}
