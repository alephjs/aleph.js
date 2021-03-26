import type { LoaderPlugin } from '../types.ts'
import marked from 'https://esm.sh/marked@2.0.1'
import { safeLoadFront } from 'https://esm.sh/yaml-front-matter@4.1.1'
import util from '../shared/util.ts'

const decoder = new TextDecoder()

export default (): LoaderPlugin => {
  return {
    name: 'markdown-loader',
    type: 'loader',
    test: /\.(md|markdown)$/i,
    acceptHMR: true,
    asPage: true,
    pagePathResolve: (url) => {
      let path = util.trimPrefix(url.replace(/\.(md|markdown)$/i, ''), '/pages')
      let isIndex = path.endsWith('/index')
      if (isIndex) {
        path = util.trimSuffix(path, '/index')
        if (path === '') {
          path = '/'
        }
      }
      return { path, isIndex }
    },
    transform: ({ content }) => {
      const { __content, ...meta } = safeLoadFront(decoder.decode(content))
      const html = marked.parse(__content)

      return {
        code: [
          `import React, { useEffect, useRef } from "https://esm.sh/react";`,
          `import { redirect } from "https://deno.land/x/aleph/mod.ts";`,
          `export default function MarkdownPage() {`,
          `  const ref = useRef(null);`,
          ``,
          `  useEffect(() => {`,
          `    const anchors = [];`,
          `    const onClick = e => {`,
          `      e.preventDefault();`,
          `      redirect(e.currentTarget.getAttribute("href"));`,
          `    };`,
          `    if (ref.current) {`,
          `      ref.current.querySelectorAll("a").forEach(a => {`,
          `        const href = a.getAttribute("href");`,
          `        if (href && !/^[a-z0-9]+:/i.test(href)) {`,
          `          a.addEventListener("click", onClick, false);`,
          `          anchors.push(a);`,
          `        }`,
          `      });`,
          `    }`,
          `    return () => anchors.forEach(a => a.removeEventListener("click", onClick));`,
          `  }, []);`,
          ``,
          `  return React.createElement("div", {`,
          `    className: "markdown-page",`,
          `    ref,`,
          `    dangerouslySetInnerHTML: { __html: ${JSON.stringify(html)} }`,
          `  });`,
          `}`,
          `MarkdownPage.meta = ${JSON.stringify(meta, undefined, 2)};`,
        ].join('\n')
      }
    }
  }
}
