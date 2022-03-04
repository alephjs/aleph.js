import { transformCSS } from "../compiler/mod.ts";
import { Targets } from "../compiler/types.ts";
import { readCode } from "../lib/fs.ts";
import { toLocalPath } from "../lib/helpers.ts";
import util from "../lib/util.ts";
import { getAlephPkgUri } from "./config.ts";

export type BundleCSSOptions = {
  targets?: Targets;
  cssModules?: boolean;
  minify?: boolean;
  resolveAlephPkgUri?: boolean;
  hmr?: boolean;
  toJS?: boolean;
};

export type BundleCSSResult = {
  code: string;
  cssModulesExports?: Record<string, string>;
  deps?: string[];
};

export async function bundleCSS(
  specifier: string,
  rawCode: string,
  options: BundleCSSOptions,
  tracing = new Set<string>(),
): Promise<BundleCSSResult> {
  let { code: css, dependencies, exports } = await transformCSS(specifier, rawCode, {
    ...options,
    analyzeDependencies: true,
    drafts: {
      nesting: true,
      customMedia: true,
    },
  });
  const deps = dependencies?.filter((dep) => dep.type === "import" && !dep.media).map((dep) => {
    let url = dep.url;
    if (util.isLikelyHttpURL(specifier)) {
      if (!util.isLikelyHttpURL(url)) {
        url = new URL(url, specifier).toString();
      }
    } else {
      url = "." + new URL(url, `file://${specifier.slice(1)}`).pathname;
    }
    return url;
  });
  const eof = options.minify ? "" : "\n";
  if (deps) {
    const imports = await Promise.all(deps.map(async (url) => {
      if (tracing.has(url)) {
        return "";
      }
      tracing.add(url);
      const [css] = await readCode(url);
      const { code, deps: subDeps } = await bundleCSS(url, css, { minify: options.minify }, tracing);
      if (subDeps) {
        deps.push(...subDeps);
      }
      return code;
    }));
    css = imports.join(eof) + eof + css;
  }
  const cssModulesExports: Record<string, string> = {};
  if (exports) {
    for (const [key, value] of Object.entries(exports)) {
      cssModulesExports[key] = value.name;
    }
  }
  if (options.toJS) {
    const alephPkgUri = getAlephPkgUri();
    return {
      code: [
        options.hmr && `import createHotContext from "${toLocalPath(alephPkgUri)}/framework/core/hmr.ts";`,
        options.hmr && `import.meta.hot = createHotContext(${JSON.stringify(specifier)});`,
        `import { applyCSS } from "${
          options.resolveAlephPkgUri ? toLocalPath(alephPkgUri) : alephPkgUri
        }/framework/core/style.ts";`,
        `export const css = ${JSON.stringify(css)};`,
        `export default ${JSON.stringify(cssModulesExports)};`,
        `applyCSS(${JSON.stringify(specifier)}, css);`,
        options.hmr && `import.meta.hot.accept();`,
      ].filter(Boolean).join(eof),
      deps,
      cssModulesExports,
    };
  }
  return { code: css, cssModulesExports, deps };
}
