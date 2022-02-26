const inDeno = typeof Deno !== "undefined" && typeof Deno.env === "object";

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
