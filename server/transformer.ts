import { transform } from "../compiler/mod.ts";
import util from "../lib/util.ts";
import { VERSION } from "../version.ts";
import { resolveImportMap } from "./importmap.ts";

/** get aleph pkg uri. */
export function getAlephPkgUri() {
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

export const serveCode = async (pathname: string, mtime?: Date) => {
  const code = await Deno.readTextFile(`.${pathname}`);
  const importMap = await resolveImportMap();
  const { code: js } = await transform(pathname, code, {
    alephPkgUri: getAlephPkgUri(),
    importMap,
  });
  const headers = new Headers({ "Content-Type": "application/javascript; charset=utf-8" });
  if (mtime) {
    headers.set("Last-Modified", mtime.toUTCString());
  }
  return new Response(js, { headers });
};
