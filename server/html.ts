import { cleanPath, isLikelyHttpURL, utf8Enc } from "../shared/util.ts";
import { concatBytes, HTMLRewriter } from "./deps.ts";
import { existsFile, getAlephPkgUri, getDeploymentId, toLocalPath } from "./helpers.ts";
import log from "./log.ts";

type LoadOptions = {
  ssr?: boolean;
  hmr?: { wsUrl?: string };
};

// load and fix the `index.html`
// - fix relative url to absolute url of `src` and `href`
// - add `./runtime/core/hmr.ts` when in `development` mode
// - add `./runtime/core/nomodule.ts`
// - check the `<ssr-body>` element if the ssr is enabled
// - add `data-defer` attribute to `<body>` if possible
// - todo: apply unocss
export async function loadIndexHtml(filepath: string, options: LoadOptions): Promise<Uint8Array | null> {
  if (await existsFile(filepath)) {
    const htmlRaw = await Deno.readFile(filepath);
    const [html, hasSSRBody] = checkSSRBody(htmlRaw);
    const fixedHtml = fixIndexHtml(html, hasSSRBody, options);
    log.debug("index.html loaded");
    return fixedHtml;
  }
  return null;
}

function checkSSRBody(html: Uint8Array): [Uint8Array, boolean] {
  const chunks: Uint8Array[] = [];
  const rewriter = new HTMLRewriter("utf8", (chunk: Uint8Array) => chunks.push(chunk));
  let hasSSRBody = false;

  rewriter.on("ssr-body", {
    element: () => hasSSRBody = true,
  });

  rewriter.on("*", {
    element: (e) => {
      if (e.hasAttribute("data-ssr-root")) {
        if (hasSSRBody) {
          e.removeAttribute("data-ssr-root");
        } else {
          e.setInnerContent("<ssr-body></ssr-body>", { html: true });
          hasSSRBody = true;
        }
      }
    },
    comments: (c) => {
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

  try {
    rewriter.write(html);
    rewriter.end();
  } finally {
    rewriter.free();
  }

  return [concatBytes(...chunks), hasSSRBody];
}

function fixIndexHtml(html: Uint8Array, hasSSRBody: boolean, { ssr, hmr }: LoadOptions): Uint8Array {
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
              `<script type="module">import hot from "${toLocalPath(alephPkgUri)}/runtime/core/hmr.ts";hot(${
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
          `<script nomodule src="${toLocalPath(alephPkgUri)}/runtime/core/nomodule.ts"></script>`,
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
      if (ssr && !hasSSRBody) {
        el.prepend("<ssr-body></ssr-body>", { html: true });
      }
    },
  });

  if (hmr) {
    rewriter.on("head", {
      element(el) {
        el.append(
          `<script type="module">import hot from "${
            toLocalPath(alephPkgUri)
          }/runtime/core/hmr.ts";hot("./index.html").decline();</script>`,
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
  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  }
  headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(content ?? await Deno.readFile(filepath), { headers });
}
