import { concat } from "https://deno.land/std@0.136.0/bytes/mod.ts";
import type { Comment, DocumentEnd, Element } from "https://deno.land/x/lol_html@0.0.3/types.d.ts";
import initLolHtml, { HTMLRewriter } from "https://deno.land/x/lol_html@0.0.3/mod.js";
import decodeLolHtmlWasm from "https://deno.land/x/lol_html@0.0.3/wasm.js";
import { toLocalPath } from "../lib/helpers.ts";
import util from "../lib/util.ts";
import { getAlephPkgUri } from "./config.ts";

await initLolHtml(decodeLolHtmlWasm());

// laod the `index.html`
// - fix relative url to absolute url of `src` and `href`
// - add `./framework/core/hmr.ts` when in `development` mode
// - add `./framework/core/nomodule.ts`
// - check the `<head>` and `<body>` elements
// - check the `<ssr-body>` element if the ssr is enabled
// - add `data-suspense` attribute to `<body>` if using suspense ssr
export async function loadAndFixIndexHtml(isDev: boolean, ssr?: { suspense?: boolean }): Promise<Uint8Array> {
  const { html, hasSSRBody } = await loadIndexHtml();
  return fixIndexHtml(html, { isDev, ssr, hasSSRBody });
}

async function loadIndexHtml(): Promise<{ html: Uint8Array; hasSSRBody: boolean }> {
  const chunks: Uint8Array[] = [];
  let hasHead = false;
  let hasBody = false;
  let hasSSRBody = false;
  const rewriter = new HTMLRewriter("utf8", (chunk: Uint8Array) => chunks.push(chunk));

  rewriter.on("head", {
    element: () => hasHead = true,
  });
  rewriter.on("body", {
    element: () => hasBody = true,
  });
  rewriter.on("ssr-body", {
    element: () => hasSSRBody = true,
  });
  rewriter.on("*", {
    element: (e: Element) => {
      if (e.hasAttribute("data-ssr-root")) {
        if (hasSSRBody) {
          e.removeAttribute("data-ssr-root");
        } else {
          e.setInnerContent("<ssr-body></ssr-body>", { html: true });
          hasSSRBody = true;
        }
      }
    },
    comments: (c: Comment) => {
      const text = c.text.trim();
      if (text === "ssr-body" || text === "ssr-output") {
        if (hasSSRBody) {
          c.remove();
        } else {
          c.replace("<ssr-body></ssr-body>", { html: true });
          hasSSRBody = true;
        }
      }
    },
  });
  rewriter.onDocument({
    end: (end: DocumentEnd) => {
      if (!hasHead) {
        end.append(`<head></head>`, { html: true });
      }
      if (!hasBody) {
        end.append(`<body></body>`, { html: true });
      }
    },
  });

  try {
    rewriter.write(await Deno.readFile("index.html"));
    rewriter.end();
    return {
      html: concat(...chunks),
      hasSSRBody,
    };
  } catch (err) {
    throw err;
  } finally {
    rewriter.free();
  }
}

function fixIndexHtml(
  html: Uint8Array,
  options: { isDev: boolean; ssr?: { suspense?: boolean }; hasSSRBody: boolean },
): Uint8Array {
  const { isDev, ssr, hasSSRBody } = options;
  const alephPkgUri = getAlephPkgUri();
  const chunks: Uint8Array[] = [];
  const rewriter = new HTMLRewriter("utf8", (chunk: Uint8Array) => chunks.push(chunk));

  rewriter.on("link", {
    element: (el: Element) => {
      let href = el.getAttribute("href");
      if (href) {
        const isHttpUrl = util.isLikelyHttpURL(href);
        if (!isHttpUrl) {
          href = util.cleanPath(href);
          el.setAttribute("href", href);
        }
        if (href.endsWith(".css") && !isHttpUrl && isDev) {
          const specifier = `.${href}`;
          el.setAttribute("data-module-id", specifier);
          el.after(
            `<script type="module">import hot from "${toLocalPath(alephPkgUri)}/framework/core/hmr.ts";hot(${
              JSON.stringify(specifier)
            }).accept();</script>`,
            { html: true },
          );
        }
      }
    },
  });
  let nomoduleInserted = false;
  rewriter.on("script", {
    element: (el: Element) => {
      const src = el.getAttribute("src");
      if (src && !util.isLikelyHttpURL(src)) {
        el.setAttribute("src", util.cleanPath(src));
      }
      if (!nomoduleInserted && el.getAttribute("type") === "module") {
        el.after(
          `<script nomodule src="${toLocalPath(alephPkgUri)}/framework/core/nomodule.ts"></script>`,
          { html: true },
        );
        nomoduleInserted = true;
      }
    },
  });
  rewriter.on("head", {
    element: (el: Element) => {
      if (isDev) {
        el.append(
          `<script type="module">import hot from "${
            toLocalPath(alephPkgUri)
          }/framework/core/hmr.ts";hot("./index.html").decline();</script>`,
          { html: true },
        );
      }
    },
  });
  if (!hasSSRBody && ssr) {
    rewriter.on("body", {
      element: (el: Element) => {
        el.prepend("<ssr-body></ssr-body>", { html: true });
      },
    });
  }
  if (ssr?.suspense) {
    rewriter.on("body", {
      element: (el: Element) => {
        el.setAttribute("data-suspense", "true");
      },
    });
  }

  try {
    rewriter.write(html);
    rewriter.end();
    return concat(...chunks);
  } catch (err) {
    throw err;
  } finally {
    rewriter.free();
  }
}

export function parseHtmlLinks(html: string | Uint8Array): Promise<string[]> {
  return new Promise((resolve, reject) => {
    try {
      const links: string[] = [];
      const rewriter = new HTMLRewriter("utf8", (_chunk: Uint8Array) => {});
      rewriter.on("link", {
        element(el: Element) {
          const href = el.getAttribute("href");
          if (href) {
            links.push(href);
          }
        },
      });
      rewriter.on("script", {
        element(el: Element) {
          const src = el.getAttribute("src");
          if (src) {
            links.push(src);
          }
        },
      });
      rewriter.onDocument({
        end: () => {
          resolve(links);
        },
      });
      try {
        rewriter.write(typeof html === "string" ? util.utf8TextEncoder.encode(html) : html);
        rewriter.end();
      } finally {
        rewriter.free();
      }
    } catch (error) {
      reject(error);
    }
  });
}

export { Comment, Element, HTMLRewriter };
