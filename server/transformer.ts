import { dirname, join } from "https://deno.land/std@0.125.0/path/mod.ts";
import { transform, transformCSS } from "../compiler/mod.ts";
import { toLocalPath, toRemoteUrl } from "../lib/path.ts";
import util from "../lib/util.ts";
import { VERSION } from "../version.ts";
import { resolveImportMap } from "./importmap.ts";

export const serveCode = async (pathname: string, env: Record<string, string>, mtime?: Date) => {
  const rawCode = await readCode(pathname);
  const isDev = env.ALEPH_ENV === "development";
  let js: string;
  if (pathname.endsWith(".css")) {
    js = await bundleCSS(pathname, rawCode, {
      minify: !isDev,
      cssModules: false,
      toJs: true,
    });
  } else {
    const importMap = await resolveImportMap();
    const ret = await transform(pathname, rawCode, {
      alephPkgUri: getAlephPkgUri(),
      isDev,
      importMap,
    });
    js = ret.code;
  }
  const headers = new Headers({ "Content-Type": "application/javascript; charset=utf-8" });
  if (mtime) {
    headers.set("Last-Modified", mtime.toUTCString());
  }
  return new Response(js, { headers });
};

async function bundleCSS(
  pathname: string,
  rawCode: string,
  options: {
    minify?: boolean;
    cssModules?: boolean;
    toJs?: boolean;
  },
  tracing = new Set<string>(),
): Promise<string> {
  const eof = options.minify ? "" : "\n";
  let { code: css, dependencies } = await transformCSS(pathname, rawCode, {
    ...options,
    analyzeDependencies: true,
  });
  if (dependencies && dependencies.length > 0) {
    const csses = await Promise.all(
      dependencies.filter((dep) => dep.type === "import").map(async (dep) => {
        const p = join(dirname(pathname), dep.url);
        if (tracing.has(p)) {
          return "";
        }
        tracing.add(p);
        return await bundleCSS(p, await readCode(p), { minify: options.minify }, tracing);
      }),
    );
    css = csses.join(eof) + eof + css;
  }
  if (options.toJs) {
    return [
      `import { applyCSS } from "${toLocalPath(getAlephPkgUri())}framework/core/style.ts";`,
      `export const css = ${JSON.stringify(css)};`,
      `export default ${JSON.stringify({})};`, // todo: moudles
      `applyCSS(${JSON.stringify(pathname)}, { css });`,
    ].join(eof);
  }
  return css;
}

async function readCode(pathname: string): Promise<string> {
  if (pathname.startsWith("/-/")) {
    return await fetch(toRemoteUrl(pathname)).then((res) => res.text());
  }
  return await Deno.readTextFile(`.${pathname}`);
}

function getAlephPkgUri() {
  const gl = globalThis as any;
  if (util.isFilledString(gl.__ALEPH_PKG_URI)) {
    return gl.__ALEPH_PKG_URI;
  }
  let uri = `https://deno.land/x/aleph@v${VERSION}`;
  const DEV_PORT = Deno.env.get("ALEPH_DEV_PORT");
  if (DEV_PORT) {
    uri = `http://localhost:${DEV_PORT}`;
  }
  gl.__ALEPH_PKG_URI = uri;
  return uri;
}
