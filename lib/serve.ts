import { readableStreamFromReader } from "https://deno.land/std@0.135.0/streams/conversion.ts";
import { basename, join } from "https://deno.land/std@0.135.0/path/mod.ts";
import { serve } from "https://deno.land/std@0.135.0/http/server.ts";
import { getContentType } from "./mime.ts";

export type ServeDirOptions = {
  port: number;
  cwd?: string;
  signal?: AbortSignal;
  loader?: (req: Request) => Promise<{ content: string | Uint8Array; contentType?: string } | null | undefined>;
};

export async function serveDir(options: ServeDirOptions) {
  const cwd = options.cwd || Deno.cwd();
  const handler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const filepath = join(cwd, url.pathname);
    try {
      const stat = await Deno.lstat(filepath);
      if (stat.isDirectory) {
        const title = basename(cwd) + url.pathname;
        const items: string[] = [];
        for await (const item of Deno.readDir(filepath)) {
          if (!item.name.startsWith(".")) {
            items.push(
              `<li><a href='${join(url.pathname, encodeURI(item.name))}'>${item.name}${
                item.isDirectory ? "/" : ""
              }<a></li>`,
            );
          }
        }
        return new Response(
          `<!DOCTYPE html><title>${title}</title><h2>&nbsp;${title}</h2><ul>${Array.from(items).join("")}</ul>`,
          {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-cache, no-store, must-revalidate",
            },
          },
        );
      }

      if (options.loader) {
        const ret = await options.loader(req);
        if (ret) {
          return new Response(ret.content, {
            headers: {
              "Content-Type": ret.contentType || getContentType(filepath),
              "Last-Modified": stat.mtime?.toUTCString() || "",
            },
          });
        }
      }

      const file = await Deno.open(filepath, { read: true });
      return new Response(readableStreamFromReader(file), {
        headers: {
          "Content-Type": getContentType(filepath),
          "Last-Modified": stat.mtime?.toUTCString() || "",
        },
      });
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        return new Response("Not found", { status: 404 });
      }
      console.error(err.stack);
      return new Response(err.message, { status: 500 });
    }
  };
  await serve(handler, { port: options.port, signal: options.signal });
}
