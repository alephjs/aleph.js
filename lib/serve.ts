import { readableStreamFromReader } from "https://deno.land/std@0.125.0/streams/conversion.ts";
import { basename, join } from "https://deno.land/std@0.125.0/path/mod.ts";
import { serve } from "https://deno.land/std@0.125.0/http/server.ts";
import { getContentType } from "./mime.ts";

export type Loader<Options = unknown> = {
  test: (url: URL) => boolean;
  load(url: URL, content: Uint8Array, options?: Options): Promise<Content> | Content;
};

export type Content = {
  content: Uint8Array;
  contentType?: string;
};

export type ServeDirOptions = {
  port: number;
  signal?: AbortSignal;
  cwd?: string;
  loaders?: Loader[];
  loaderOptions?: unknown;
};

export async function serveDir(options: ServeDirOptions) {
  const cwd = options.cwd || Deno.cwd();
  const handler = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
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

      const loader = options.loaders?.find((loader) => loader.test(url));
      if (loader) {
        let ret = loader.load(url, await Deno.readFile(filepath), options.loaderOptions);
        if (ret instanceof Promise) {
          ret = await ret;
        }
        return new Response(ret.content, {
          headers: {
            "Content-Type": ret.contentType || getContentType(filepath),
            "Last-Modified": stat.mtime?.toUTCString() || "",
          },
        });
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
