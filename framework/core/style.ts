// deno-lint-ignore-file ban-ts-comment

export function applyCSS(url: string, css: string) {
  const { document } = globalThis;
  if (document) {
    const ssrEl = Array.from<Element>(document.head.children).find((el: Element) =>
      el.getAttribute("data-module-id") === url &&
      el.hasAttribute("ssr")
    );
    if (ssrEl) {
      // apply the css at next time
      ssrEl.removeAttribute("ssr");
    } else {
      const prevEls = Array.from(document.head.children).filter((el: Element) => {
        return el.getAttribute("data-module-id") === url;
      });
      const el = document.createElement("style");
      el.setAttribute("data-module-id", url);
      el.appendChild(document.createTextNode(css));
      document.head.appendChild(el);
      if (prevEls.length > 0) {
        prevEls.forEach((el) => document.head.removeChild(el));
      }
    }
  }
}

export function applyUnoCSS(url: string, css: string, debug = false) {
  let unocssSheet: CSSStyleSheet | null = null;
  if (globalThis.document?.styleSheets) {
    for (const sheet of document.styleSheets) {
      if (sheet.ownerNode && (sheet.ownerNode as HTMLStyleElement).hasAttribute("data-unocss")) {
        unocssSheet = sheet;
        break;
      }
    }
  }

  if (unocssSheet) {
    try {
      const sheet = new CSSStyleSheet();
      // @ts-ignore
      sheet.replaceSync(css);
      const oldRules: number[] = [];
      for (let index = 0; index < unocssSheet.cssRules.length; index++) {
        const rule = unocssSheet.cssRules[index] as unknown as { ownerUrl: string };
        if (rule.ownerUrl === url) {
          oldRules.unshift(index);
        }
      }
      for (const rule of sheet.cssRules) {
        let { cssText } = rule;
        // fix for chrome drops `mask` webkit prefix
        if (cssText.startsWith(".i-")) {
          cssText = cssText.replace(/(mask:[^;]+;)/, "$1-webkit-$1");
        }
        unocssSheet.insertRule(cssText, unocssSheet.cssRules.length);
        // @ts-ignore
        unocssSheet.cssRules[unocssSheet.cssRules.length - 1].ownerUrl = url;
      }
      for (const index of oldRules) {
        unocssSheet.deleteRule(index);
      }
      if (debug) {
        console.log(`[UnoCSS] ${sheet.cssRules.length} rules added, ${oldRules.length} rules deleted by "${url}"`);
      }
      return;
    } catch (_e) {
      if (debug) {
        console.warn("The browser doesn't support the CSSStyleSheet.");
      }
    }
  }

  // fallback to create a new style element
  applyCSS(url, css);
}
