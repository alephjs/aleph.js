import util from "../lib/util.ts";
import { concatBytes, HTMLRewriter, initLolHtml, lolHtmlWasm } from "./deps.ts";
import { getAlephPkgUri, getDeploymentId, toLocalPath } from "./helpers.ts";
import type { Comment, Element } from "./types.ts";

// init `lol-html` Wasm
await initLolHtml(lolHtmlWasm());

const defaultIndexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body><h2>Not Found</h2></body>
</html>
`;

type LoadOptions = {
  isDev?: boolean;
  ssr?: { dataDefer?: boolean };
  hmrWebSocketUrl?: string;
};

// load and fix the `index.html`
// - fix relative url to absolute url of `src` and `href`
// - add `./framework/core/hmr.ts` when in `development` mode
// - add `./framework/core/nomodule.ts`
// - check the `<ssr-body>` element if the ssr is enabled
// - add `data-defer` attribute to `<body>` if possible
// - todo: apply unocss
export async function loadAndFixIndexHtml(filepath: string, options: LoadOptions): Promise<Uint8Array> {
  const { html, hasSSRBody } = await loadIndexHtml(filepath);
  return fixIndexHtml(html, hasSSRBody, options);
}

async function loadIndexHtml(filepath: string): Promise<{ html: Uint8Array; hasSSRBody: boolean }> {
  const chunks: Uint8Array[] = [];
  let hasSSRBody = false;
  const rewriter = new HTMLRewriter("utf8", (chunk: Uint8Array) => chunks.push(chunk));

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

  let html: Uint8Array;
  try {
    html = await Deno.readFile(filepath);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      html = util.utf8TextEncoder.encode(defaultIndexHtml);
    } else {
      throw err;
    }
  }

  try {
    rewriter.write(html);
    rewriter.end();
    return {
      html: concatBytes(...chunks),
      hasSSRBody,
    };
  } finally {
    rewriter.free();
  }
}

function fixIndexHtml(html: Uint8Array, hasSSRBody: boolean, options: LoadOptions): Uint8Array {
  const { isDev, ssr, hmrWebSocketUrl } = options;
  const alephPkgUri = getAlephPkgUri();
  const chunks: Uint8Array[] = [];
  const rewriter = new HTMLRewriter("utf8", (chunk: Uint8Array) => chunks.push(chunk));
  const deployId = getDeploymentId();

  rewriter.on("link", {
    element: (el: Element) => {
      let href = el.getAttribute("href");
      if (href) {
        const isHttpUrl = util.isLikelyHttpURL(href);
        if (!isHttpUrl) {
          href = util.cleanPath(href);
          if (deployId) {
            href += (href.includes("?") ? "&v=" : "?v=") + deployId;
          }
          el.setAttribute("href", href);
        } else {
          href = toLocalPath(href);
        }
        el.setAttribute("href", href);
        if (isDev && !isHttpUrl && href.split("?")[0].endsWith(".css")) {
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
      let src = el.getAttribute("src");
      if (src) {
        if (!util.isLikelyHttpURL(src)) {
          src = util.cleanPath(src);
          if (deployId) {
            src += (src.includes("?") ? "&v=" : "?v=") + deployId;
          }
          el.setAttribute("src", src);
        } else {
          src = toLocalPath(src);
        }
        el.setAttribute("src", src);
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
  rewriter.on("body", {
    element: (el: Element) => {
      if (ssr?.dataDefer) {
        el.setAttribute("data-defer", "true");
      }
      if (deployId) {
        el.setAttribute("data-deployment-id", deployId);
      }
      if (ssr && !hasSSRBody) {
        el.prepend("<ssr-body></ssr-body>", { html: true });
      }
    },
  });

  if (isDev && hmrWebSocketUrl) {
    rewriter.on("head", {
      element(el: Element) {
        el.append(`<script>window.__hmrWebSocketUrl=${JSON.stringify(hmrWebSocketUrl)};</script>`, {
          html: true,
        });
      },
    });
  }

  try {
    rewriter.write(html);
    rewriter.end();
    return concatBytes(...chunks);
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
      const rewriter = new HTMLRewriter("utf8", () => {});
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
