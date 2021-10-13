import type { Aleph, LoadInput, LoadOutput, ResolveResult, Plugin } from '../types.d.ts'
import { safeLoadFront } from 'https://esm.sh/yaml-front-matter@4.1.1'
import marked from 'https://esm.sh/marked@3.0.4?no-check'
import hljs from 'https://esm.sh/highlight.js@10.7.1?bundle'
import unescape from 'https://esm.sh/unescape@1.0.1?bundle'
import util from '../shared/util.ts'

const test = /\.(md|markdown)$/i
const reCodeTag = /<code class="language\-([^"]+)">([\s\S]+?)<\/code>/g

export const markdownResovler = (specifier: string): ResolveResult => {
  let pagePath = util.trimPrefix(specifier.replace(/\.(md|markdown)$/i, ''), '/pages')
  let isIndex = pagePath.endsWith('/index')
  if (isIndex) {
    pagePath = util.trimSuffix(pagePath, '/index')
    if (pagePath === '') {
      pagePath = '/'
    }
  }
  return { asPage: { path: pagePath, isIndex } }
}

export const markdownLoader = async ({ specifier }: LoadInput, aleph: Aleph, { highlight }: Options = {}): Promise<LoadOutput> => {
  const { framework } = aleph.config
  const { content } = await aleph.fetchModule(specifier)
  const { __content, ...meta } = safeLoadFront((new TextDecoder).decode(content))
  const props = {
    id: util.isString(meta.id) ? meta.id : undefined,
    className: util.isString(meta.className) ? meta.className.trim() : undefined,
    style: util.isPlainObject(meta.style) ? Object.entries(meta.style).reduce((prev, [key, value]) => {
      prev[key.replaceAll(/\-[a-z]/g, m => m.slice(1).toUpperCase())] = value
      return prev
    }, {} as Record<string, any>) : undefined,
  }
  let html: string = marked.parse(__content)
  if (highlight) {
    html = html.replace(reCodeTag, (_, language, code) => {
      const h = hljs.highlight(unescape(code), { language }).value
      return `<code class="language-${language} hljs">${h}</code>`
    })
  }
  const code = [
    `import { createElement } from 'https://esm.sh/react'`,
    `import HTMLPage from 'https://deno.land/x/aleph/framework/react/components/HTMLPage.ts'`,
    highlight && `import 'https://esm.sh/highlight.js@10.7.1/styles/${highlight.theme || 'default'}.css'`,
    `export default function MarkdownPage(props) {`,
    `  return createElement(HTMLPage, {`,
    `    ...${JSON.stringify(props)},`,
    `    ...props,`,
    `    html: ${JSON.stringify(html)}`,
    `  })`,
    `}`,
    `MarkdownPage.meta = ${JSON.stringify(meta)}`,
  ]

  if (framework === 'react') {
    return {
      code: code.filter(Boolean).join('\n')
    }
  }

  throw new Error(`markdown-loader: don't support framework '${framework}'`)
}

export type Options = {
  highlight?: {
    provider: 'highlight.js', // todo: support prism and other libs
    theme?: string
  }
}

export default (options?: Options): Plugin => {
  return {
    name: 'markdown-loader',
    setup: aleph => {
      aleph.onResolve(test, markdownResovler)
      aleph.onLoad(test, input => markdownLoader(input, aleph, options))
    }
  }
}
