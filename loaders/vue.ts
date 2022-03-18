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
import type { ModuleLoader, ModuleLoaderContent, ModuleLoaderEnv } from "../server/types.ts";

type Options = {
  script?: Omit<SFCScriptCompileOptions, "id">;
  template?: Partial<SFCTemplateCompileOptions>;
  style?: Partial<SFCAsyncStyleCompileOptions>;
};

export default class VueSFCLoader implements ModuleLoader {
  #options: Options;

  constructor(options?: Options) {
    this.#options = { ...options };
  }

  test(pathname: string): boolean {
    return pathname.endsWith(".vue");
  }

  async load(pathname: string, env: ModuleLoaderEnv): Promise<ModuleLoaderContent> {
    const stat = await Deno.lstat(`.${pathname}`);
    const content = await Deno.readTextFile(`.${pathname}`);
    const filename = "." + pathname;
    const id = (await util.computeHash("SHA-256", filename)).slice(0, 8);
    const { descriptor } = parse(content, { filename });
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
    const output = [mainScript];
    if (env.isDev && !env.ssr && descriptor.template) {
      const templateResult = compileTemplate({
        ...templateOptions,
        source: descriptor.template.content,
      });
      if (templateResult.errors.length > 0) {
        output.push(`/* SSR compile error: ${templateResult.errors[0]} */`);
      } else {
        output.push(templateResult.code.replace("export function render(", "__sfc__.render = function render("));
      }
    }
    output.push(`__sfc__.__file = ${JSON.stringify(filename)}`);
    if (descriptor.styles.some((s) => s.scoped)) {
      output.push(`__sfc__.__scopeId = ${JSON.stringify(`data-v-${id}`)}`);
    }
    if (!env.ssr && env.isDev) {
      const mainScriptHash = (await util.computeHash("SHA-256", mainScript)).slice(0, 8);
      output.push(`__sfc__.__scriptHash = ${JSON.stringify(mainScriptHash)}`);
      output.push(`__sfc__.__hmrId = ${JSON.stringify(id)}`);
      output.push(`window.__VUE_HMR_RUNTIME__?.createRecord(__sfc__.__hmrId, __sfc__)`);
      output.push(`let __currentScriptHash = ${JSON.stringify(mainScriptHash)}`);
      output.push(
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
    output.push(`export default __sfc__`);

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

    return {
      code: output.join("\n"),
      modtime: stat?.mtime?.getTime(),
      lang: isTS ? "ts" : "js",
      inlineCSS: css || undefined,
      atomicCSS: true,
    };
  }
}
