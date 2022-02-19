import { join } from "https://deno.land/std@0.125.0/path/mod.ts";
import { existsDir, existsFile } from "./fs.ts";
import log from "./log.ts";
import util from "./util.ts";

const enc = new TextEncoder();

/** download and cache remote contents */
export default async function cache(
  url: string,
  options?: { forceRefresh?: boolean; retryTimes?: number; userAgent?: string },
): Promise<Response> {
  const { protocol, hostname, port, pathname, search } = new URL(url);
  const isLocalhost = ["localhost", "0.0.0.0", "127.0.0.1"].includes(hostname);
  const denoDir = Deno.env.get("DENO_DIR");
  const save = !isLocalhost && denoDir;

  let cacheDir = "";
  let hashname = "";
  let metaFilepath = "";
  let contentFilepath = "";
  if (save) {
    cacheDir = join(denoDir, "deps", util.trimSuffix(protocol, ":"), hostname + (port ? "_PORT" + port : ""));
    hashname = util.toHex(
      await crypto.subtle.digest("sha-256", enc.encode(pathname + search + (options?.userAgent || ""))),
    );
    metaFilepath = join(cacheDir, hashname + ".metadata.json");
    contentFilepath = join(cacheDir, hashname);
  }

  if (
    !options?.forceRefresh && save && await existsFile(contentFilepath) &&
    await existsFile(metaFilepath)
  ) {
    const [content, meta] = await Promise.all([
      Deno.readFile(contentFilepath),
      Deno.readTextFile(metaFilepath),
    ]);
    try {
      const { headers = {} } = JSON.parse(meta);
      return new Response(content, { headers });
    } catch (_e) {
      return new Response(content);
    }
  }

  const retryTimes = options?.retryTimes ?? 3;
  let finalRes = new Response("Server Error", { status: 500 });
  for (let i = 0; i < retryTimes; i++) {
    if (i === 0) {
      if (!isLocalhost) {
        log.info("Download", url);
      }
    } else {
      log.warn(`Download ${url} failed, retrying...`);
    }

    const res = await fetch(url, { headers: options?.userAgent ? { "User-Agent": options?.userAgent } : undefined });
    if (res.status >= 500) {
      finalRes = res;
      continue;
    }

    if (save) {
      const buffer = await res.arrayBuffer();
      const content = new Uint8Array(buffer);
      const headers: Record<string, string> = {};
      res.headers.forEach((val, key) => {
        headers[key] = val;
      });
      if (!(await existsDir(cacheDir))) {
        await Deno.mkdir(cacheDir, { recursive: true });
      }
      await Promise.all([
        Deno.writeFile(contentFilepath, content),
        Deno.writeTextFile(
          metaFilepath,
          JSON.stringify(
            { headers, url, now: { secs_since_epoch: Math.round(Date.now() / 1000), nanos_since_epoch: 0 } },
            undefined,
            2,
          ),
        ),
      ]);
      return new Response(content, { headers: res.headers });
    }

    return res;
  }

  return finalRes;
}
