import { readableStreamFromReader } from "https://deno.land/std@0.145.0/streams/conversion.ts";
import { basename, join } from "https://deno.land/std@0.145.0/path/mod.ts";
import { Server, type ServerInit } from "https://deno.land/std@0.145.0/http/server.ts";
import { getContentType } from "./media_type.ts";

export type ServeInit = ServerInit & {
  certFile?: string;
  keyFile?: string;
  signal?: AbortSignal;
  onListenSuccess?: (port: number) => void;
};

export async function serve(options: ServeInit) {
  const server = new Server(options);

  let port: number;
  let listener: Deno.Listener;

  if (options.certFile && options.keyFile) {
    port = options.port ?? 443;
    listener = Deno.listenTls({
      port,
      hostname: options.hostname ?? "0.0.0.0",
      certFile: options.certFile,
      keyFile: options.keyFile,
      transport: "tcp",
      // ALPN protocol support not yet stable.
      // alpnProtocols: ["h2", "http/1.1"],
    });
  } else {
    port = options.port ?? 80;
    listener = Deno.listen({
      port,
      hostname: options.hostname ?? "0.0.0.0",
      transport: "tcp",
    });
  }

  options?.signal?.addEventListener("abort", () => server.close(), {
    once: true,
  });

  options.onListenSuccess?.(port);

  await server.serve(listener);
}

export type ServeDirOptions = Omit<ServeInit, "handler"> & {
  workingDir?: string;
  loader?: (req: Request) => Promise<{ content: string | Uint8Array; headers?: HeadersInit } | null | undefined>;
};

export async function serveDir(options: ServeDirOptions) {
  const workingDir = options.workingDir || Deno.cwd();
  const handler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const filepath = join(workingDir, url.pathname);
    try {
      const stat = await Deno.lstat(filepath);
      if (stat.isDirectory) {
        const title = basename(workingDir) + url.pathname;
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
          const headers = new Headers(ret.headers);
          if (!headers.has("Content-Type")) {
            headers.set("Content-Type", getContentType(filepath));
          }
          if (stat.mtime) {
            headers.set("Last-Modified", stat.mtime.toUTCString());
          }
          return new Response(ret.content, { headers });
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

  await serve({ ...options, handler });
}
