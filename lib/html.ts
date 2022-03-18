import type { Element } from "https://deno.land/x/lol_html@0.0.3/types.d.ts";
import initLolHtml, { HTMLRewriter } from "https://deno.land/x/lol_html@0.0.3/mod.js";
import decodeLolHtmlWasm from "https://deno.land/x/lol_html@0.0.3/wasm.js";
import util from "./util.ts";

await initLolHtml(decodeLolHtmlWasm());

export function parseHtmlLinks(html: string | Uint8Array): Promise<string[]> {
  return new Promise((resolve, reject) => {
    try {
      const links: string[] = [];
      const rewriter = new HTMLRewriter("utf8", (_chunk: Uint8Array) => {});
      const linkHandler = {
        element(el: Element) {
          const href = el.getAttribute("href");
          if (href) {
            links.push(href);
          }
        },
      };
      const scriptHandler = {
        nomoduleInserted: false,
        element(el: Element) {
          const src = el.getAttribute("src");
          if (src) {
            links.push(src);
          }
        },
      };
      rewriter.on("link", linkHandler);
      rewriter.on("script", scriptHandler);
      try {
        rewriter.write(typeof html === "string" ? util.utf8TextEncoder.encode(html) : html);
        rewriter.end();
      } finally {
        rewriter.free();
      }
      resolve(links);
    } catch (error) {
      reject(error);
    }
  });
}

export { Element, HTMLRewriter };
