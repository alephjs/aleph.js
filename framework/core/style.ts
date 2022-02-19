const inDeno = typeof Deno !== "undefined" && typeof Deno.env === "object";
const trashBin = new Map<string, string>();

export function applyCSS(url: string, css: string) {
  if (!inDeno) {
    const { document } = window;
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
      const cleanup = () =>
        setTimeout(() => {
          if (prevEls.length > 0) {
            prevEls.forEach((el) => document.head.removeChild(el));
          }
        }, 0);
      const el = document.createElement("style");
      el.appendChild(document.createTextNode(css));
      cleanup();
      el.setAttribute("data-module-id", url);
      document.head.appendChild(el);
    }
  }
}

export function removeCSS(url: string, recoverable?: boolean) {
  const { document } = window;
  Array.from(document.head.children).forEach((el) => {
    if (el.getAttribute("data-module-id") === url) {
      if (recoverable) {
        trashBin.set(url, el.innerHTML);
      }
      document.head.removeChild(el);
    }
  });
}

export function recoverCSS(url: string) {
  if (trashBin.has(url)) {
    applyCSS(url, trashBin.get(url)!);
  }
}
