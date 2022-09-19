import { generateHydrationScript, renderToStream } from "solid-js/web";
import { serve as alephServe, type ServerOptions } from "../../server/mod.ts";
import type { SSRContext, SSROptions } from "../../server/types.ts";
import SolidTransformer from "./transformer.ts";

const render = (ctx: SSRContext): [ReadableStream | string, number] => {
  const App = ctx.routeModules[0]?.defaultExport; // routes/index.tsx
  if (!App) {
    return ["<p>404 page not found</p>", 404];
  }
  ctx.headCollection.push(generateHydrationScript());
  const { readable, writable } = new TransformStream();
  renderToStream(App as () => unknown).pipeTo(writable);
  return [readable, 200];
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
