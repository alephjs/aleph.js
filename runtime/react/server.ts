import { createElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { serve as alephServe, type ServerOptions } from "../../server/mod.ts";
import type { SSRContext, SSROptions } from "../../server/types.ts";
import { App } from "./router.ts";

if (Deno.args.includes("--dev")) {
  // Enable react refresh
  Deno.env.set("REACT_REFRESH", "true");
}

const render = (ctx: SSRContext) => {
  return renderToReadableStream(createElement(App, { ssrContext: ctx }), ctx);
};

export function serve(
  options?: Omit<ServerOptions, "ssr"> & { ssr?: boolean | (SSROptions & { suspense?: boolean }) },
) {
  alephServe({
    ...options,
    ssr: options?.ssr
      ? {
        ...(typeof options.ssr === "object" ? options.ssr : {}),
        render,
      }
      : undefined,
  });
}
