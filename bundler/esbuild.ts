// @deno-types="https://deno.land/x/esbuild@v0.14.20/mod.d.ts"
import { build, Plugin, stop } from "https://deno.land/x/esbuild@v0.14.20/mod.js";
import { join } from "https://deno.land/std@0.125.0/path/mod.ts";
import { cache } from "../lib/cache.ts";
import util from "../lib/util.ts";

export { build as esbuild, stop as stopEsbuild };

export const cssPlugin: Plugin = {
  name: "css-resolver",
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      const isRemote = util.isLikelyHttpURL(args.path);
      const [path] = util.splitBy(
        isRemote ? args.path : util.trimPrefix(args.path, "file://"),
        "#",
      );

      if (
        args.kind === "url-token" ||
        (args.kind === "import-rule" && (isRemote || path.startsWith("/")))
      ) {
        return { path: path, external: true };
      }

      // ensure the `path` is an absolute path
      if (!path.startsWith("/")) {
        return { path: join(args.resolveDir, path) };
      }

      return { path };
    });
  },
};

export const httpImportPlugin: Plugin = {
  name: "http-import-loader",
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      const isRemote = util.isLikelyHttpURL(args.path);
      const [path] = util.splitBy(
        isRemote ? args.path : util.trimPrefix(args.path, "file://"),
        "#",
      );

      if (
        args.kind === "url-token" ||
        (args.kind === "import-rule" && (isRemote || path.startsWith("/")))
      ) {
        return { path: path, external: true };
      }

      if (isRemote) {
        return {
          path,
          namespace: "http",
        };
      }

      if (args.namespace === "http") {
        return {
          path: (new URL(path, args.importer)).toString(),
          namespace: "http",
        };
      }

      // ensure the `path` is an absolute path
      if (!path.startsWith("/")) {
        return { path: join(args.resolveDir, path) };
      }

      return { path };
    });

    build.onLoad({ filter: /.*/, namespace: "http" }, async (args) => {
      const { content } = await cache(args.path);
      return { contents: content };
    });
  },
};
