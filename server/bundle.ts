import util from "../lib/util.ts";
import { transformCSS } from "./deps.ts";
import { getAlephPkgUri, readCode, toLocalPath } from "./helpers.ts";
import type { Targets } from "./types.ts";

export type BundleCSSOptions = {
  targets?: Targets;
  minify?: boolean;
  cssModules?: boolean;
  asJsModule?: boolean;
  hmr?: boolean;
};

export type BundleCSSResult = {
  code: string;
  cssModulesExports?: Record<string, string>;
  deps?: string[];
};

/**
 * Bundle the css using `parcel-css` with `nesting` and `customMedia` draft support.
 *
 * https://github.com/parcel-bundler/parcel-css
 */
export async function bundleCSS(
  specifier: string,
  sourceCode: string,
  options: BundleCSSOptions,
  tracing = new Set<string>(),
): Promise<BundleCSSResult> {
  let { code: css, dependencies, exports } = await transformCSS(specifier, sourceCode, {
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
  dependencies?.forEach((dep) => {
    if (dep.type === "url") {
      // todo: use magic-string
      css = css.replace(`url("${dep.placeholder}")`, `url("${dep.url}")`);
    }
  });
  const eof = options.minify ? "" : "\n";
  if (deps) {
    const imports = await Promise.all(deps.map(async (url) => {
      if (tracing.has(url)) {
        return "";
      }
      tracing.add(url);
      const [css] = await readCode(url);
      const { code, deps: subDeps } = await bundleCSS(
        url,
        css,
        { targets: options.targets, minify: options.minify },
        tracing,
      );
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
  if (options.asJsModule) {
    const alephPkgPath = toLocalPath(getAlephPkgUri());
    return {
      code: [
        options.hmr && `import createHotContext from "${alephPkgPath}/framework/core/hmr.ts";`,
        options.hmr && `import.meta.hot = createHotContext(${JSON.stringify(specifier)});`,
        `import { applyCSS } from "${alephPkgPath}/framework/core/style.ts";`,
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
