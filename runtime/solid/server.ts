import { generateHydrationScript, renderToString } from "solid-js/web";
import { serve as alephServe, type ServerOptions } from "../../server/mod.ts";
import type { SSRContext, SSROptions } from "../../server/types.ts";
import SolidTransformer from "./transformer.ts";

const render = (ctx: SSRContext) => {
  const App = ctx.routeModules[0]?.defaultExport; // routes/index.tsx
  if (!App) {
    return "404 page not found";
  }
  ctx.headCollection.push(generateHydrationScript());
  return renderToString(App as () => unknown);
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
