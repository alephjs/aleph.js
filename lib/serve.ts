import { readableStreamFromReader } from "https://deno.land/std@0.125.0/streams/conversion.ts";
import { basename, join } from "https://deno.land/std@0.125.0/path/mod.ts";
import { getContentType } from "./mime.ts";

export type ServerOptions = {
  port: number;
  cwd?: string;
  loaders?: Loader[];
};

export type Loader = {
  test: (url: string) => boolean;
  load(filepath: string, code: Uint8Array): Promise<Content> | Content;
};

export type Content = {
  content: Uint8Array;
  contentType: string;
};

export async function serveDir(options: ServerOptions) {
  const cwd = options.cwd || Deno.cwd();
  const s = Deno.listen({ port: options.port });
  const serve = async (conn: Deno.Conn) => {
    const httpConn = Deno.serveHttp(conn);
    for await (const { request, respondWith } of httpConn) {
      await handle(request, respondWith);
    }
  };
  const handle = async (request: Request, respondWith: (r: Response | Promise<Response>) => Promise<void>) => {
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
        respondWith(
          new Response(
            `<!DOCTYPE html><title>${title}</title><h2>&nbsp;${title}</h2><ul>${Array.from(items).join("")}</ul>`,
            {
              headers: new Headers({ "Content-Type": "text/html; charset=utf-8" }),
            },
          ),
        );
        return;
      }

      const loader = options.loaders?.find((loader) => loader.test(request.url));
      if (loader) {
        let ret = loader.load(request.url, await Deno.readFile(filepath));
        if (ret instanceof Promise) {
          ret = await ret;
        }
        respondWith(
          new Response(ret.content, {
            headers: {
              "Content-Type": ret.contentType,
              "Last-Modified": stat.mtime?.toUTCString() || "",
            },
          }),
        );
        return;
      }

      const file = await Deno.open(filepath, { read: true });
      respondWith(
        new Response(readableStreamFromReader(file), {
          headers: {
            "Content-Type": getContentType(filepath),
            "Last-Modified": stat.mtime?.toUTCString() || "",
          },
        }),
      );
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        respondWith(new Response("Not found", { status: 404 }));
        return;
      }
      respondWith(new Response(err.message, { status: 500 }));
    }
  };

  for await (const conn of s) {
    serve(conn);
  }
}
