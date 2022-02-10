import { dirname, join } from "https://deno.land/std@0.125.0/path/mod.ts";
import { transform, transformCSS } from "../compiler/mod.ts";
import { toLocalPath, toRemoteUrl } from "../lib/path.ts";
import util from "../lib/util.ts";
import { VERSION } from "../version.ts";
import { resolveImportMap } from "./importmap.ts";

export const serveCode = async (pathname: string, env: Record<string, string>, mtime?: Date) => {
  const rawCode = await readCode(pathname);
  let js: string;
  if (pathname.endsWith(".css")) {
    const css = await bundleCSS(pathname, rawCode, env.ALEPH_ENV !== "development", false);
    js = [
      `import { applyCSS } from "${toLocalPath(getAlephPkgUri())}framework/core/style.ts"`,
      `export const css = ${JSON.stringify(css)}`,
      `export default ${JSON.stringify({})}`, // todo: moudles
      `applyCSS(${JSON.stringify(pathname)}, { css })`,
    ].join("\n");
  } else {
    const importMap = await resolveImportMap();
    const ret = await transform(pathname, rawCode, {
      isDev: env.ALEPH_ENV === "development",
      alephPkgUri: getAlephPkgUri(),
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
  minify: boolean,
  cssModules: boolean,
  tracing = new Set<string>(),
): Promise<string> {
  let { code: css, dependencies } = await transformCSS(pathname, rawCode, {
    cssModules,
    minify,
    analyzeDependencies: true,
  });
  if (dependencies && dependencies.length > 0) {
    const sp = minify ? "" : "\n";
    const csses = await Promise.all(
      dependencies.filter((dep) => dep.type === "import").map(async (dep) => {
        const p = join(dirname(pathname), dep.url);
        if (tracing.has(p)) {
          return "";
        }
        tracing.add(p);
        return await bundleCSS(p, await readCode(p), minify, false, tracing);
      }),
    );
    return csses.join(sp) + sp + css;
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
