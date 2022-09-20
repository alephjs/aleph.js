import { createComponent } from "solid-js";
import { generateHydrationScript, renderToStream } from "solid-js/web";
import { serve as alephServe, type ServerOptions } from "../../server/mod.ts";
import type { SSRContext, SSROptions } from "../../server/types.ts";
import SolidTransformer from "./transformer.ts";

const render = (ctx: SSRContext): ReadableStream | string => {
  const App = ctx.routing[0]?.exports.default; // routes/index.tsx
  if (!App) {
    ctx.setStatus(404);
    return "<p>404 page not found</p>";
  }
  ctx.headCollection.push(generateHydrationScript());
  const { readable, writable } = new TransformStream();
  renderToStream(
    () => createComponent(App as () => null, {}),
    { nonce: ctx.nonce },
  ).pipeTo(writable);
  return readable;
};

export function serve(
  options?: Omit<ServerOptions, "ssr"> & { ssr?: boolean | SSROptions },
) {
  alephServe({
    ...options,
    loaders: [...(options?.loaders ?? []), new SolidTransformer()],
    ssr: options?.ssr
      ? {
        ...(typeof options.ssr === "object" ? options.ssr : {}),
        render,
      }
      : undefined,
  });
}
