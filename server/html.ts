import { cleanPath, isLikelyHttpURL, utf8Enc } from "../shared/util.ts";
import { concatBytes, HTMLRewriter, initLolHtml, lolHtmlWasm } from "./deps.ts";
import { existsFile, getAlephPkgUri, getDeploymentId, toLocalPath } from "./helpers.ts";
import log from "./log.ts";

type LoadOptions = {
  ssr?: { root?: string };
  hmr?: { wsUrl?: string };
};

// init lol-html wasm
await initLolHtml(lolHtmlWasm());

// load and fix the `index.html`
// - fix relative url to absolute url of `src` and `href`
// - add `./framework/core/hmr.ts` when in `development` mode
// - add `./framework/core/nomodule.ts`
// - add `data-defer` attribute to `<body>` if possible
// - todo: apply unocss
export async function loadIndexHtml(filepath: string, options: LoadOptions = {}): Promise<Uint8Array | null> {
  if (await existsFile(filepath)) {
    const htmlRaw = await Deno.readFile(filepath);
    const fixedHtml = fixIndexHtml(htmlRaw, options);
    log.debug("index.html loaded");
    return fixedHtml;
  }
  return null;
}

function fixIndexHtml(html: Uint8Array, { hmr, ssr }: LoadOptions): Uint8Array {
  const alephPkgUri = getAlephPkgUri();
  const chunks: Uint8Array[] = [];
  const rewriter = new HTMLRewriter("utf8", (chunk: Uint8Array) => chunks.push(chunk));
  const deploymentId = getDeploymentId();
  let nomoduleInserted = false;

  rewriter.on("link", {
    element: (el) => {
      let href = el.getAttribute("href");
      if (href) {
        const isHttpUrl = isLikelyHttpURL(href);
        if (!isHttpUrl) {
          const pathname = cleanPath(href);
          if (hmr && pathname.endsWith(".css")) {
            const specifier = `.${pathname}`;
            el.setAttribute("data-module-id", specifier);
            el.after(
              `<script type="module">import hot from "${toLocalPath(alephPkgUri)}/framework/core/hmr.ts";hot(${
                JSON.stringify(specifier)
              }).accept();</script>`,
              { html: true },
            );
          }
          href = pathname;
          if (deploymentId) {
            href += (pathname.includes("?") ? "&v=" : "?v=") + deploymentId;
          }
        } else {
          href = toLocalPath(href);
        }
        el.setAttribute("href", href);
      }
    },
  });

  rewriter.on("script", {
    element: (el) => {
      let src = el.getAttribute("src");
      if (src) {
        if (!isLikelyHttpURL(src)) {
          src = cleanPath(src);
          if (deploymentId) {
            src += (src.includes("?") ? "&v=" : "?v=") + deploymentId;
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

  rewriter.on("body", {
    element: (el) => {
      if (deploymentId) {
        el.setAttribute("data-deployment-id", deploymentId);
      }
    },
  });

  if (ssr) {
    rewriter.on(ssr.root ?? "#root", {
      element(el) {
        el.append(`<ssr-body></ssr-body>`, {
          html: true,
        });
      },
    });
  }

  if (hmr) {
    rewriter.on("head", {
      element(el) {
        el.append(
          `<script type="module">import hot from "${
            toLocalPath(alephPkgUri)
          }/framework/core/hmr.ts";hot("./index.html").decline();</script>`,
          { html: true },
        );
        if (hmr.wsUrl) {
          el.append(`<script>window.__hmrWebSocketUrl=${JSON.stringify(hmr.wsUrl)};</script>`, {
            html: true,
          });
        }
      },
    });
  }

  try {
    rewriter.write(html);
    rewriter.end();
  } finally {
    rewriter.free();
  }

  return concatBytes(...chunks);
}

export function parseHtmlLinks(html: string | Uint8Array): Promise<string[]> {
  return new Promise((resolve, reject) => {
    try {
      const links: string[] = [];
      const rewriter = new HTMLRewriter("utf8", () => {});
      rewriter.on("link", {
        element(el) {
          const href = el.getAttribute("href");
          if (href) {
            links.push(href);
          }
        },
      });
      rewriter.on("script", {
        element(el) {
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
        rewriter.write(typeof html === "string" ? utf8Enc.encode(html) : html);
        rewriter.end();
      } finally {
        rewriter.free();
      }
    } catch (error) {
      reject(error);
    }
  });
}

export async function createHtmlResponse(
  req: Request,
  filepath: string,
  content?: Uint8Array,
): Promise<Response> {
  const deployId = getDeploymentId();
  const headers = new Headers();
  let etag: string | undefined;
  if (deployId) {
    etag = `W/${deployId}`;
  } else {
    const { mtime, size } = await Deno.lstat(filepath);
    if (mtime) {
      etag = `W/${mtime.getTime().toString(16)}-${size.toString(16)}`;
      headers.set("Last-Modified", new Date(mtime).toUTCString());
    }
  }
  if (etag) {
    if (req.headers.get("If-None-Match") === etag) {
      return new Response(null, { status: 304 });
    }
    headers.set("ETag", etag);
  }
  headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(content ?? await Deno.readFile(filepath), { headers });
}
