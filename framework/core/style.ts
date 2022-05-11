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

export function applyUnoCSS(url: string, css: string) {
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
      const tokens = new Set(
        Array.from(unocssSheet.cssRules).map((rule) => {
          // @ts-ignore
          if (rule.media || rule.cssText.startsWith("@media")) {
            return rule.cssText.split("{").slice(0, 2).join(">").trim();
          }
          // @ts-ignore
          return rule.selectorText || rule.cssText.split("{")[0].trim();
        }),
      );
      for (const rule of sheet.cssRules) {
        let key: string;
        // @ts-ignore
        if (rule.media || rule.cssText.startsWith("@media")) {
          key = rule.cssText.split("{").slice(0, 2).join(">").trim();
        } else {
          // @ts-ignore
          key = rule.selectorText || rule.cssText.split("{")[0].trim();
        }
        if (!tokens.has(key)) {
          let { cssText } = rule;
          // fix for chrome drop `mask` webkit prefix
          if (key.startsWith(".i-")) {
            cssText = cssText.replace(/(mask:[^;]+;)/, "$1-webkit-$1");
          }
          unocssSheet.insertRule(cssText, unocssSheet.cssRules.length);
        }
      }
      return;
    } catch (error) {
      console.error(error);
    }
  }

  // fallback to create a new style element
  applyCSS(url, css);
}
