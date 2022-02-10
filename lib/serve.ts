import { basename, join } from "https://deno.land/std@0.125.0/path/mod.ts";
import { getContentType } from "./mime.ts";

export async function serveDir(cwd: string, port: number) {
  const s = Deno.listen({ port });
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
      const info = await Deno.lstat(filepath);
      if (info.isDirectory) {
        const r = Deno.readDir(filepath);
        const items: string[] = [];
        for await (const item of r) {
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
            `<!DOCTYPE html><title>${basename(cwd)}${url.pathname}</title><h2>&nbsp;aleph.js${url.pathname}</h2><ul>${
              Array.from(items).join("")
            }</ul>`,
            {
              headers: new Headers({ "Content-Type": "text/html; charset=utf-8" }),
            },
          ),
        );
        return;
      }
      respondWith(
        new Response(
          await Deno.readFile(filepath),
          {
            headers: new Headers({ "Content-Type": getContentType(filepath) }),
          },
        ),
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
