import { transform, transformCSS } from "../compiler/mod.ts";
import { toLocalPath, toRemoteUrl } from "../lib/path.ts";
import util from "../lib/util.ts";
import { VERSION } from "../version.ts";
import { resolveImportMap } from "./importmap.ts";

export const serveCode = async (pathname: string, mtime?: Date) => {
  let rawCode: string;
  let js: string;
  if (pathname.startsWith("/-/")) {
    rawCode = await fetch(toRemoteUrl(pathname)).then((res) => res.text());
  } else {
    rawCode = await Deno.readTextFile(`.${pathname}`);
  }
  if (pathname.endsWith(".css")) {
    const { code: css } = await transformCSS(pathname, rawCode, {});
    js = [
      `import { applyCSS } from "${toLocalPath(getAlephPkgUri())}framework/core/style.ts"`,
      `export const css = ${JSON.stringify(css)}`,
      `export default ${JSON.stringify({})}`, // todo: moudles
      `applyCSS(${JSON.stringify(pathname)}, { css })`,
    ].join("\n");
  } else {
    const importMap = await resolveImportMap();
    const ret = await transform(pathname, rawCode, {
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
