import { readableStreamFromReader } from "https://deno.land/std@0.140.0/streams/conversion.ts";
import log from "../lib/log.ts";
import { builtinModuleExts, getDeploymentId, regFullVersion } from "./helpers.ts";
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

    switch (pathname) {
      case "/server.js":
      case "/server.js.map":
      case "/server_dependency_graph.js":
        return new Response("Not Found", { status: 404 });
    }

    try {
      let filePath = `./${outputDir}${pathname}`;
      let ctype = "application/javascript; charset=utf-8";
      if (
        searchParams.has("module") ||
        (pathname.startsWith("/-/esm.sh/") && !pathname.endsWith(".js") && !pathname.endsWith(".css"))
      ) {
        filePath += ".js";
      }
      if (pathname.endsWith(".css") && !searchParams.has("module")) {
        ctype = "text/css; charset=utf-8";
      }
      const headers = new Headers({ "Content-Type": ctype });
      const deployId = getDeploymentId();
      let etag: string | null = null;
      if (deployId) {
        etag = `W/${btoa(pathname).replace(/[^a-z0-9]/g, "")}-${deployId}`;
      } else {
        const stat = await Deno.lstat(filePath);
        if (!stat.isFile) {
          return new Response("Not Found", { status: 404 });
        }
        const { mtime, size } = stat;
        if (mtime) {
          etag = `W/${mtime.getTime().toString(16)}-${size.toString(16)}`;
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
        return new Response("Not Found", { status: 404 });
      }
      log.error(err);
      return new Response("Internal Server Error", { status: 500 });
    }
  },
};
