import { readableStreamFromReader } from "https://deno.land/std@0.128.0/streams/conversion.ts";
import log from "../lib/log.ts";
import type { AlephConfig } from "./types.ts";

export default {
  fetch: async (req: Request): Promise<Response> => {
    const config: AlephConfig | undefined = Reflect.get(globalThis, "__ALEPH_SERVER_CONFIG");
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
      const stat = await Deno.lstat(filePath);
      if (stat.isFile) {
        const { mtime } = stat;
        const etag = mtime ? mtime.getTime().toString(16) + "-" + stat.size.toString(16) : null;
        if (etag && req.headers.get("If-None-Match") === etag) {
          return new Response(null, { status: 304 });
        }
        const file = await Deno.open(filePath, { read: true });
        const headers = new Headers({ "Content-Type": ctype });
        if (mtime) {
          headers.set("Etag", etag!);
          headers.set("Last-Modified", mtime.toUTCString());
        }
        return new Response(readableStreamFromReader(file), { headers });
      }
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) {
        log.error(err);
        return new Response("Internal Server Error", { status: 500 });
      }
    }
    return new Response("Not Found", { status: 404 });
  },
};
