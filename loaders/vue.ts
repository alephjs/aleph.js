import type {
  CompilerOptions,
  SFCAsyncStyleCompileOptions,
  SFCScriptCompileOptions,
  SFCTemplateCompileOptions,
} from "https://esm.sh/@vue/compiler-sfc@3.2.31";
import { compileScript, compileStyleAsync, parse, rewriteDefault } from "https://esm.sh/@vue/compiler-sfc@3.2.31";
import log from "../lib/log.ts";
import util from "../lib/util.ts";
import { transform } from "../compiler/mod.ts";
import { getAlephPkgUri } from "../server/config.ts";
import type { ImportMap, Loader, LoaderContent } from "../server/types.ts";

type Options = {
  /** vue import source, default is `https://esm.sh/vue` */
  runtimeModuleName?: string;
  /** vue SSR import source, default is `https://esm.sh/@vue/server-renderer` */
  ssrRuntimeModuleName?: string;
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
    if (!descriptor.scriptSetup) {
      throw new Error("VueSFCLoader: currentlly only support vue files with script `setup`");
    }
    const expressionPlugins: CompilerOptions["expressionPlugins"] = isTS ? ["typescript"] : undefined;
    const compiledScript = compileScript(descriptor, {
      inlineTemplate: true,
      ...this.#options?.script,
      id,
      templateOptions: {
        ...this.#options?.template,
        isProd: !env.isDev,
        ssr: env.ssr,
        ssrCssVars: descriptor.cssVars,
        compilerOptions: {
          ...this.#options?.template?.compilerOptions,
          runtimeModuleName: this.#options.runtimeModuleName ?? env.importMap?.imports["vue"] ?? "https://esm.sh/vue",
          ssrRuntimeModuleName: this.#options.ssrRuntimeModuleName ?? env.importMap?.imports["@vue/server-renderer"] ??
            "https://esm.sh/@vue/server-renderer",
          expressionPlugins,
        },
      },
    });

    let js = "";
    js += rewriteDefault(compiledScript.content, "__sfc__", expressionPlugins) + "\n";
    js += `__sfc__.__file = ${JSON.stringify(filename)}\n`;
    if (descriptor.styles.some((s) => s.scoped)) {
      js += `__sfc__.__scopeId = ${JSON.stringify(`data-v-${id}`)}\n`;
    }
    js += `export default __sfc__\n`;

    // post-process
    const { code } = env.ssr ? { code: js } : await transform(filename + (isTS ? ".ts" : ".js"), js, {
      alephPkgUri: getAlephPkgUri(),
      isDev: env.isDev,
      importMap: env.importMap ? JSON.stringify(env.importMap) : undefined,
    });

    let css = "";
    for (const style of descriptor.styles) {
      if (style.module) {
        throw new Error(`VueSFCLoader: <style module> is not supported yet.`);
      }

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
      } else {
        css += styleResult.code + "\n";
      }
    }

    return {
      content: new TextEncoder().encode(code),
      contentType: "application/javascript; charset=utf-8",
      inlineCSS: css || undefined,
    };
  }
}
