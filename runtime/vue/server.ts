import { renderToWebStream } from "@vue/server-renderer";
import { builtinModuleExts } from "../../server/helpers.ts";
import VueLoader from "../../loaders/vue.ts";
import { serve as alephServe, type ServerOptions } from "../../server/mod.ts";
import type { SSRContext, SSROptions } from "../../server/types.ts";
import { createApp } from "./router.ts";

const render = (ctx: SSRContext) => renderToWebStream(createApp({ ssrContext: ctx }), ctx);

export function serve(
  options?: Omit<ServerOptions, "ssr"> & { ssr?: boolean | SSROptions },
) {
  console.log({
    ...options,
    loaders: [...(options?.loaders ?? []), new VueLoader()],
    router: {
      ...options?.router,
      exts: options?.router?.exts ?? ["vue", ...builtinModuleExts],
    },
    ssr: options?.ssr
      ? {
        render,
        ...(typeof options.ssr === "object" ? options.ssr : {}),
      }
      : undefined,
  });
  alephServe({
    ...options,
    loaders: [...(options?.loaders ?? []), new VueLoader()],
    router: {
      ...options?.router,
      exts: options?.router?.exts ?? ["vue", ...builtinModuleExts],
    },
    ssr: options?.ssr
      ? {
        render,
        ...(typeof options.ssr === "object" ? options.ssr : {}),
      }
      : undefined,
  });
}
