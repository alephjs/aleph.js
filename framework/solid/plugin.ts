import { createComponent } from "solid-js";
import { generateHydrationScript, renderToStream } from "solid-js/web";
import { assertString, isPlainObject } from "../../shared/util.ts";
import { getAlephConfig, getAlephPkgUri, toLocalPath } from "../../server/helpers.ts";
import { importRouteModule } from "../../server/router.ts";
import type { Plugin, SSRContext, SSROptions } from "../../server/types.ts";
import SolidTransformer from "./transformer.ts";

const render = async (ctx: SSRContext): Promise<ReadableStream | string> => {
  const config = getAlephConfig();
  assertString(config?.router?.moduleURL);
  const { Router } = await importRouteModule({
    filename: toLocalPath(config.router.moduleURL),
    pattern: { pathname: "__router__" },
  });
  const { readable, writable } = new TransformStream();
  ctx.headCollection.push(generateHydrationScript());
  renderToStream(() => createComponent(Router, { ssrContext: ctx }), { nonce: ctx.nonce }).pipeTo(writable);
  return readable;
};

export default function SolidPlugin(options?: { ssr?: boolean | SSROptions }): Plugin {
  return {
    name: "solid",
    setup(aleph) {
      const alephPkgUri = getAlephPkgUri();
      Object.assign(aleph, {
        loaders: [new SolidTransformer(), ...(aleph.loaders ?? [])],
        router: {
          ...aleph.router,
          moduleURL: `${alephPkgUri}/framework/solid/router.tsx`,
        },
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
