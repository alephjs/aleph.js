import { join } from "https://deno.land/std@0.144.0/path/mod.ts";
import log from "./log.ts";
import util from "./util.ts";

type Meta = {
  url: string;
  headers: Record<string, string>;
  now: {
    secs_since_epoch: number;
    nanos_since_epoch: number;
  };
};

const memoryCache = new Map<string, [content: Uint8Array, meta: Meta]>();
const reloaded = new Set<string>();

/** fetch and cache remote contents */
export default async function cache(
  url: string,
  options?: { forceRefresh?: boolean; retryTimes?: number; userAgent?: string },
): Promise<Response> {
  const { protocol, hostname, port, pathname, search } = new URL(url);
  const isLocalhost = ["localhost", "0.0.0.0", "127.0.0.1"].includes(hostname);
  const modulesCacheDir = Deno.env.get("MODULES_CACHE_DIR");
  const hashname = isLocalhost ? "" : await util.computeHash("sha-256", pathname + search + (options?.userAgent || ""));

  let cacheDir = "";
  let metaFilepath = "";
  let contentFilepath = "";
  if (modulesCacheDir) {
    cacheDir = join(modulesCacheDir, util.trimSuffix(protocol, ":"), hostname + (port ? "_PORT" + port : ""));
    contentFilepath = join(cacheDir, hashname);
    metaFilepath = join(cacheDir, hashname + ".metadata.json");
  }

  if (!options?.forceRefresh && !isLocalhost) {
    if (modulesCacheDir) {
      if (await existsFile(contentFilepath) && await existsFile(metaFilepath)) {
        const reload = Deno.env.get("ALEPH_RELOAD_FLAG");
        if (!reload || reloaded.has(url)) {
          const [content, metaJSON] = await Promise.all([
            Deno.readFile(contentFilepath),
            Deno.readTextFile(metaFilepath),
          ]);
          try {
            const meta = JSON.parse(metaJSON);
            if (!isExpired(meta)) {
              return new Response(content, { headers: { ...meta.headers, "cache-hit": "true" } });
            }
          } catch (_e) {
            log.debug(`skip cache of ${url}: invalid cache metadata file`);
          }
        } else {
          reloaded.add(url);
        }
      }
    } else if (memoryCache.has(hashname)) {
      const [content, meta] = memoryCache.get(hashname)!;
      if (!isExpired(meta)) {
        return new Response(content, { headers: { ...meta.headers, "cache-hit": "true" } });
      }
    }
  }

  const retryTimes = options?.retryTimes ?? 3;
  let finalRes = new Response("Server Error", { status: 500 });
  for (let i = 0; i < retryTimes; i++) {
    if (i === 0) {
      if (!isLocalhost) {
        log.debug("Download", url);
      }
    } else {
      log.warn(`Download ${url} failed, retrying...`);
    }

    const res = await fetch(url, { headers: options?.userAgent ? { "User-Agent": options?.userAgent } : undefined });
    if (res.status >= 500) {
      finalRes = res;
      continue;
    }

    if (res.ok && !isLocalhost) {
      const buffer = await res.arrayBuffer();
      const content = new Uint8Array(buffer);
      const meta: Meta = {
        url,
        headers: {},
        now: {
          secs_since_epoch: Math.round(Date.now() / 1000),
          nanos_since_epoch: 0,
        },
      };
      res.headers.forEach((val, key) => {
        meta.headers[key] = val;
      });
      if (modulesCacheDir) {
        if (!(await existsDir(cacheDir))) {
          await Deno.mkdir(cacheDir, { recursive: true });
        }
        await Promise.all([
          Deno.writeFile(contentFilepath, content),
          Deno.writeTextFile(metaFilepath, JSON.stringify(meta, undefined, 2)),
        ]);
      } else {
        memoryCache.set(hashname, [content, meta]);
      }
      return new Response(content, { headers: res.headers });
    }

    return res;
  }

  return finalRes;
}

/* check whether or not the given path exists as a directory. */
async function existsDir(path: string): Promise<boolean> {
  try {
    const stat = await Deno.lstat(path);
    return stat.isDirectory;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return false;
    }
    throw err;
  }
}

/* check whether or not the given path exists as regular file. */
async function existsFile(path: string): Promise<boolean> {
  try {
    const stat = await Deno.lstat(path);
    return stat.isFile;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return false;
    }
    throw err;
  }
}

function isExpired(meta: Meta) {
  const cc = meta.headers["cache-control"];
  const dataCacheTtl = cc && cc.includes("max-age=") ? parseInt(cc.split("max-age=")[1]) : undefined;
  if (dataCacheTtl) {
    const now = Date.now();
    const expireTime = (meta.now.secs_since_epoch + dataCacheTtl) * 1000;
    if (now > expireTime) {
      return true;
    }
  }
  return false;
}
