import depGraph from "../server/graph.ts";
import type { Plugin } from "../server/types.ts";
import { isFilledArray } from "../shared/util.ts";

/** A plugin for Deno Deploy which doesn't support the dynamic import. */
export default function DenoDeployPlugin({ modules }: { modules: Record<string, Record<string, unknown>> }): Plugin {
  return {
    name: "deploy",
    setup(aleph, env) {
      if (!env.isDev) {
        if (isFilledArray(modules.depGraph?.modules)) {
          modules.depGraph.modules.forEach((module) => {
            depGraph.mark(module.specifier, module);
          });
        }
        aleph.router = { ...aleph.router, modules };
      }
    },
  };
}
