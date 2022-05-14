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
    const sheet = createCSSStyleSheet(css);
    if (sheet) {
      const tokens = new Set<string>();
      const medias = new Map<string, CSSRuleList>();
      for (const rule of unocssSheet.cssRules) {
        // @ts-ignore
        const { cssText, media, cssRules: mediaCSSRules } = rule;
        if ((media || cssText.startsWith("@media")) && mediaCSSRules) {
          const cond: string = getConditionText(rule);
          medias.set(cond, mediaCSSRules);
        }
        tokens.add(getSelectorText(rule));
      }
      for (const rule of sheet.cssRules) {
        // @ts-ignore
        const { cssText, media, cssRules: mediaCSSRules } = rule;
        if ((media || cssText.startsWith("@media")) && mediaCSSRules) {
          const cond = getConditionText(rule);
          if (medias.has(cond)) {
            const tokens = new Set<string>();
            const mediaCSSLines: string[] = [];
            for (const rule of medias.get(cond)!) {
              tokens.add(getSelectorText(rule));
              mediaCSSLines.push(fixCSSText(rule.cssText));
            }
            let hasNewRule = false;
            for (const rule of mediaCSSRules) {
              if (!tokens.has(getSelectorText(rule))) {
                mediaCSSLines.push(fixCSSText(rule.cssText));
                hasNewRule = true;
              }
            }
            if (hasNewRule) {
              insertMediaRule(unocssSheet, cond, `@media ${cond} {${mediaCSSLines.join("\n")}}`);
            }
          } else {
            insertMediaRule(unocssSheet, cond, cssText);
          }
        } else if (!tokens.has(getSelectorText(rule))) {
          unocssSheet.insertRule(fixCSSText(cssText), unocssSheet.cssRules.length);
        }
      }
      return;
    }
  }

  // fallback to create a new style element
  applyCSS(url, css);
}

function insertMediaRule(sheet: CSSStyleSheet, conditionText: string, cssText: string) {
  // delete the old media rule
  for (let i = 0; i < sheet.cssRules.length; i++) {
    const rule = sheet.cssRules[i];
    // @ts-ignore
    if (rule.media || rule.cssText.startsWith("@media")) {
      const cond: string = getConditionText(rule);
      if (cond === conditionText) {
        sheet.deleteRule(i);
        break;
      }
    }
  }
  // insert the new media rule at the end
  sheet.insertRule(cssText, sheet.cssRules.length);
}

function getSelectorText(rule: CSSRule): string {
  // @ts-ignore
  return rule.selectorText || rule.cssText.split("{")[0].trim();
}

function getConditionText(rule: CSSRule): string {
  // @ts-ignore
  return rule.conditionText || rule.cssText.substring(6, cssText.indexOf("{")).trim();
}

const isChorme = globalThis.document && /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);

function fixCSSText(cssText: string): string {
  // fix chrome dropping `mask` webkit prefix
  if (isChorme && cssText.startsWith(".i-")) {
    return cssText.replace(/(mask:[^;]+;)/, "$1-webkit-$1");
  }
  return cssText;
}

function createCSSStyleSheet(css: string): CSSStyleSheet | null {
  try {
    const sheet = new CSSStyleSheet();
    // @ts-ignore
    sheet.replaceSync(css);
    return sheet;
  } catch (_e) {
    const el = document.createElement("style");
    el.appendChild(document.createTextNode(css));
    el.media = "(max-width: 1px)";
    document.head.appendChild(el);
    setTimeout(() => {
      document.head.removeChild(el);
    }, 0);
    for (const sheet of document.styleSheets) {
      if (sheet.ownerNode === el) {
        sheet.disabled = false;
        return sheet;
      }
    }
  }
  console.warn("The browser does not support CSSStyleSheet!");
  return null;
}
