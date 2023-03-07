import { generateHydrationScript, renderToStream } from "solid-js/web";
import { isPlainObject } from "../../shared/util.ts";
import type { Plugin, SSRContext, SSROptions } from "../../server/types.ts";
import SolidTransformer from "./transformer.ts";

const render = (ctx: SSRContext): ReadableStream | string => {
  const App = ctx.modules[0]?.exports.default; // routes/index.tsx
  if (!App) {
    ctx.setStatus(404);
    return "<p>404 page not found</p>";
  }
  ctx.headCollection.push(generateHydrationScript());
  const { readable, writable } = new TransformStream();
  // deno-lint-ignore no-explicit-any
  renderToStream(App as () => any, { nonce: ctx.nonce }).pipeTo(writable);
  return readable;
};

export default function SolidPlugin(options?: { ssr?: boolean | SSROptions }): Plugin {
  return {
    name: "solid",
    setup(aleph) {
      Object.assign(aleph, {
        loaders: [new SolidTransformer(), ...(aleph.loaders ?? [])],
        ssr: options?.ssr
          ? {
            ...(isPlainObject(options.ssr) ? options.ssr : {}),
            render,
          }
          : undefined,
      });
    },
  };
}
