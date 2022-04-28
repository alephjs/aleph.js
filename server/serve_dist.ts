import { readableStreamFromReader } from "https://deno.land/std@0.136.0/streams/conversion.ts";
import { builtinModuleExts, regFullVersion } from "../lib/helpers.ts";
import log from "../lib/log.ts";
import type { AlephConfig } from "./types.ts";

export default {
  test: (pathname: string) => {
    return pathname.startsWith("/-/") ||
      (builtinModuleExts.find((ext) => pathname.endsWith(`.${ext}`)) && !pathname.endsWith(".d.ts")) ||
      pathname.endsWith(".css");
  },
  fetch: async (req: Request): Promise<Response> => {
    const config: AlephConfig | undefined = Reflect.get(globalThis, "__ALEPH_CONFIG");
    const outputDir = config?.build?.outputDir ?? "dist";
    const { pathname, searchParams } = new URL(req.url);
    try {
      let filePath = `./${outputDir}${pathname}`;
      let ctype = "application/javascript; charset=utf-8";
      if (searchParams.has("module") || pathname.startsWith("/-/esm.sh/")) {
        filePath += `.js`;
      }
      if (pathname.endsWith(".css") && !searchParams.has("module")) {
        ctype = "text/css; charset=utf-8";
      }
      const headers = new Headers({ "Content-Type": ctype });
      const deployId = Deno.env.get("DENO_DEPLOYMENT_ID");
      let etag: string | null = null;
      if (deployId) {
        etag = `${btoa(pathname).replace(/[^a-z0-9]/g, "")}-${deployId}`;
      } else {
        const stat = await Deno.lstat(filePath);
        if (!stat.isFile) {
          return new Response("File Not Found", { status: 404 });
        }
        const { mtime, size } = stat;
        if (mtime) {
          etag = mtime.getTime().toString(16) + "-" + size.toString(16);
          headers.append("Last-Modified", new Date(mtime).toUTCString());
        }
      }
      if (etag && req.headers.get("If-None-Match") === etag) {
        return new Response(null, { status: 304 });
      }
      const file = await Deno.open(filePath, { read: true });
      if (etag) {
        headers.append("Etag", etag);
      }
      if (searchParams.get("v") || (pathname.startsWith("/-/") && regFullVersion.test(pathname))) {
        headers.append("Cache-Control", "public, max-age=31536000, immutable");
      }
      return new Response(readableStreamFromReader(file), { headers });
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        return new Response("File Not Found", { status: 404 });
      }
      log.error(err);
      return new Response("Internal Server Error", { status: 500 });
    }
  },
};
