import { renderToWebStream } from "@vue/server-renderer";
import { builtinModuleExts } from "../../server/helpers.ts";
import { serve as alephServe, type ServerOptions } from "../../server/mod.ts";
import type { SSRContext, SSROptions } from "../../server/types.ts";
import { createApp } from "./router.ts";
import SFCLoader from "./sfc_loader.ts";

const render = (ctx: SSRContext) => renderToWebStream(createApp({ ssrContext: ctx }), ctx);

export function serve(
  options?: Omit<ServerOptions, "ssr"> & { ssr?: boolean | SSROptions },
) {
  alephServe({
    ...options,
    loaders: [...(options?.loaders ?? []), new SFCLoader()],
    router: {
      exts: ["vue", ...builtinModuleExts],
      ...options?.router,
    },
    ssr: options?.ssr
      ? {
        ...(typeof options.ssr === "object" ? options.ssr : {}),
        render,
      }
      : undefined,
  });
}
