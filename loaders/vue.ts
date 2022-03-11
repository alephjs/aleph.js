import type {
  CompilerOptions,
  SFCAsyncStyleCompileOptions,
  SFCScriptCompileOptions,
  SFCTemplateCompileOptions,
} from "https://esm.sh/@vue/compiler-sfc@3.2.31";
import {
  compileScript,
  compileStyleAsync,
  compileTemplate,
  parse,
  rewriteDefault,
} from "https://esm.sh/@vue/compiler-sfc@3.2.31";
import log from "../lib/log.ts";
import util from "../lib/util.ts";
import { fastTransform, transform } from "../compiler/mod.ts";
import { getAlephPkgUri } from "../server/config.ts";
import type { ImportMap, Loader, LoaderContent } from "../server/types.ts";

type Options = {
  script?: Omit<SFCScriptCompileOptions, "id">;
  template?: Partial<SFCTemplateCompileOptions>;
  style?: Partial<SFCAsyncStyleCompileOptions>;
};

export default class VueSFCLoader implements Loader {
  #options: Options;

  constructor(options?: Options) {
    this.#options = { ...options };
  }

  test(req: Request): boolean {
    const url = new URL(req.url);
    return url.pathname.endsWith(".vue");
  }

  async load(req: Request, env: { importMap?: ImportMap; isDev?: boolean; ssr?: boolean }): Promise<LoaderContent> {
    const url = new URL(req.url);
    const content = await Deno.readTextFile(`.${url.pathname}`);
    const filename = "." + url.pathname;
    const id = (await util.computeHash("SHA-256", filename)).slice(0, 8);
    const { descriptor } = parse(content, { filename: "." + url.pathname });
    const scriptLang = (descriptor.script && descriptor.script.lang) ||
      (descriptor.scriptSetup && descriptor.scriptSetup.lang);
    const isTS = scriptLang === "ts";
    if (scriptLang && !isTS) {
      throw new Error(`VueSFCLoader: Only lang="ts" is supported for <script> blocks.`);
    }
    if (descriptor.styles.some((style) => style.module)) {
      console.warn(`VueSFCLoader: <style module> is not supported yet.`);
    }
    const expressionPlugins: CompilerOptions["expressionPlugins"] = isTS ? ["typescript"] : undefined;
    const templateOptions: Omit<SFCTemplateCompileOptions, "source"> = {
      ...this.#options?.template,
      id,
      filename: descriptor.filename,
      scoped: descriptor.styles.some((s) => s.scoped),
      slotted: descriptor.slotted,
      isProd: !env.isDev,
      ssr: env.ssr,
      ssrCssVars: descriptor.cssVars,
      compilerOptions: {
        ...this.#options?.template?.compilerOptions,
        runtimeModuleName: this.#options?.template?.compilerOptions?.runtimeModuleName ??
          env.importMap?.imports["vue"] ?? "https://esm.sh/vue",
        ssrRuntimeModuleName: this.#options?.template?.compilerOptions?.ssrRuntimeModuleName ??
          env.importMap?.imports["vue/server-renderer"] ??
          env.importMap?.imports["@vue/server-renderer"] ??
          "https://esm.sh/@vue/server-renderer",
        expressionPlugins,
      },
    };
    const compiledScript = compileScript(descriptor, {
      inlineTemplate: !env.isDev || env.ssr,
      ...this.#options?.script,
      id,
      templateOptions,
    });

    const mainScript = rewriteDefault(compiledScript.content, "__sfc__", expressionPlugins);
    const jsLines = [mainScript];
    if (env.isDev && !env.ssr && descriptor.template) {
      const templateResult = compileTemplate({
        ...templateOptions,
        source: descriptor.template.content,
      });
      if (templateResult.errors.length > 0) {
        jsLines.push(`/* SSR compile error: ${templateResult.errors[0]} */`);
      } else {
        jsLines.push(templateResult.code.replace("export function render(", "__sfc__.render = function render("));
      }
    }
    jsLines.push(`__sfc__.__file = ${JSON.stringify(filename)}`);
    if (descriptor.styles.some((s) => s.scoped)) {
      jsLines.push(`__sfc__.__scopeId = ${JSON.stringify(`data-v-${id}`)}`);
    }
    if (!env.ssr && env.isDev) {
      const mainScriptHash = (await util.computeHash("SHA-256", mainScript)).slice(0, 8);
      jsLines.push(`__sfc__.__scriptHash = ${JSON.stringify(mainScriptHash)}`);
      jsLines.push(`__sfc__.__hmrId = ${JSON.stringify(id)}`);
      jsLines.push(`window.__VUE_HMR_RUNTIME__?.createRecord(__sfc__.__hmrId, __sfc__)`);
      jsLines.push(`let __currentScriptHash = ${JSON.stringify(mainScriptHash)}`);
      jsLines.push(
        `import.meta.hot.accept(({ default: sfc }) => {`,
        `  const rerenderOnly = __currentScriptHash === sfc.__scriptHash`,
        `  if (rerenderOnly) {`,
        `    __currentScriptHash = sfc.__scriptHash; // update '__currentScriptHash'`,
        `    __VUE_HMR_RUNTIME__.rerender(sfc.__hmrId, sfc.render)`,
        `  } else {`,
        `    __VUE_HMR_RUNTIME__.reload(sfc.__hmrId, sfc)`,
        `  }`,
        `})`,
      );
    }
    jsLines.push(`export default __sfc__`);

    // post-process
    const js = jsLines.join("\n");
    const { code, deps: scriptDeps = [] } = env.ssr
      ? await fastTransform(filename, js, {
        importMap: env.importMap ? JSON.stringify(env.importMap) : undefined,
        lang: isTS ? "ts" : "js",
        isDev: env.isDev,
      })
      : await transform(filename, js, {
        alephPkgUri: getAlephPkgUri(),
        importMap: env.importMap ? JSON.stringify(env.importMap) : undefined,
        lang: isTS ? "ts" : "js",
        isDev: env.isDev,
      });
    const deps = scriptDeps.map(({ specifier }) => specifier);
    const css = (await Promise.all(descriptor.styles.map(async (style) => {
      const styleResult = await compileStyleAsync({
        ...this.#options.style,
        source: style.content,
        filename,
        id,
        scoped: style.scoped,
        modules: false,
      });
      if (styleResult.errors.length) {
        // postcss uses pathToFileURL which isn't polyfilled in the browser
        // ignore these errors for now
        const msg = styleResult.errors[0].message;
        if (!msg.includes("pathToFileURL")) {
          log.warn(`VueSFCLoader: ${msg}`);
        }
        // proceed even if css compile errors
        return "";
      } else {
        return styleResult.code;
      }
    }))).join("\n");
    if (css) {
      deps.push(`inline-css:${css}`);
    }

    return {
      content: new TextEncoder().encode(code),
      contentType: "application/javascript; charset=utf-8",
      deps,
    };
  }
}
