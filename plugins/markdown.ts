import type { Aleph, LoadInput, LoadOutput, ResolveResult, Plugin } from '../types.d.ts'
import marked from 'https://esm.sh/marked@3.0.4'
import { safeLoadFront } from 'https://esm.sh/yaml-front-matter@4.1.1'
import util from '../shared/util.ts'

const hljsUri = 'https://esm.sh/highlight.js@10.7.1'
const languages = new Set([
  '1c',
  'abnf',
  'accesslog',
  'actionscript',
  'ada',
  'angelscript',
  'apache',
  'applescript',
  'arcade',
  'arduino',
  'armasm',
  'xml',
  'asciidoc',
  'aspectj',
  'autohotkey',
  'autoit',
  'avrasm',
  'awk',
  'axapta',
  'bash',
  'basic',
  'bnf',
  'brainfuck',
  'c',
  'cal',
  'capnproto',
  'ceylon',
  'clean',
  'clojure',
  'clojure-repl',
  'cmake',
  'coffeescript',
  'coq',
  'cos',
  'cpp',
  'crmsh',
  'crystal',
  'csharp',
  'csp',
  'css',
  'd',
  'markdown',
  'dart',
  'delphi',
  'diff',
  'django',
  'dns',
  'dockerfile',
  'dos',
  'dsconfig',
  'dts',
  'dust',
  'ebnf',
  'elixir',
  'elm',
  'ruby',
  'erb',
  'erlang-repl',
  'erlang',
  'excel',
  'fix',
  'flix',
  'fortran',
  'fsharp',
  'gams',
  'gauss',
  'gcode',
  'gherkin',
  'glsl',
  'gml',
  'go',
  'golo',
  'gradle',
  'groovy',
  'haml',
  'handlebars',
  'haskell',
  'haxe',
  'hsp',
  'http',
  'hy',
  'inform7',
  'ini',
  'irpf90',
  'isbl',
  'java',
  'javascript',
  'jboss-cli',
  'json',
  'julia',
  'julia-repl',
  'kotlin',
  'lasso',
  'latex',
  'ldif',
  'leaf',
  'less',
  'lisp',
  'livecodeserver',
  'livescript',
  'llvm',
  'lsl',
  'lua',
  'makefile',
  'mathematica',
  'matlab',
  'maxima',
  'mel',
  'mercury',
  'mipsasm',
  'mizar',
  'perl',
  'mojolicious',
  'monkey',
  'moonscript',
  'n1ql',
  'nestedtext',
  'nginx',
  'nim',
  'nix',
  'node-repl',
  'nsis',
  'objectivec',
  'ocaml',
  'openscad',
  'oxygene',
  'parser3',
  'pf',
  'pgsql',
  'php',
  'php-template',
  'plaintext',
  'pony',
  'powershell',
  'processing',
  'profile',
  'prolog',
  'properties',
  'protobuf',
  'puppet',
  'purebasic',
  'python',
  'python-repl',
  'q',
  'qml',
  'r',
  'reasonml',
  'rib',
  'roboconf',
  'routeros',
  'rsl',
  'ruleslanguage',
  'rust',
  'sas',
  'scala',
  'scheme',
  'scilab',
  'scss',
  'shell',
  'smali',
  'smalltalk',
  'sml',
  'sqf',
  'sql',
  'stan',
  'stata',
  'step21',
  'stylus',
  'subunit',
  'swift',
  'taggerscript',
  'yaml',
  'tap',
  'tcl',
  'thrift',
  'tp',
  'twig',
  'typescript',
  'vala',
  'vbnet',
  'vbscript',
  'vbscript-html',
  'verilog',
  'vhdl',
  'vim',
  'wasm',
  'wren',
  'x86asm',
  'xl',
  'xquery',
  'zephir',
])
const languageAlias = {
  'js': 'javascript',
  'jsx': 'javascript',
  'ts': 'typescript',
  'tsx': 'typescript',
  'py': 'python',
  'make': 'makefile',
  'md': 'markdown',
  'ps': 'powershell',
  'rs': 'rust',
  'styl': 'stylus',
}

const test = /\.(md|markdown)$/i
const reCodeLanguage = /<code class="language\-([^"]+)"/g

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
  const html = marked.parse(__content)
  const props = {
    id: util.isString(meta.id) ? meta.id : undefined,
    className: util.isString(meta.className) ? meta.className.trim() : undefined,
    style: util.isPlainObject(meta.style) ? Object.entries(meta.style).reduce((prev, [key, value]) => {
      prev[key.replaceAll(/\-[a-z]/g, m => m.slice(1).toUpperCase())] = value
      return prev
    }, {} as Record<string, any>) : undefined,
  }
  const code = [
    `import { createElement, useEffect, useRef } from 'https://esm.sh/react'`,
    `import HTMLPage from 'https://deno.land/x/aleph/framework/react/components/HTMLPage.ts'`,
    `export default function MarkdownPage(props) {`,
    `  return createElement(HTMLPage, {`,
    `    ...${JSON.stringify(props)},`,
    `    ...props,`,
    `    html: ${JSON.stringify(html)}`,
    `  })`,
    `}`,
    `MarkdownPage.meta = ${JSON.stringify(meta)}`,
  ]
  if (highlight) {
    const extra: string[] = [`import hljs from '${hljsUri}/lib/core'`]
    const activated: Set<string> = new Set()
    const hooks = [
      `  const ref = useRef()`,
      `  useEffect(() => ref.current && ref.current.querySelectorAll('code').forEach(el => hljs.highlightElement(el)), [])`
    ]
    for (const m of html.matchAll(reCodeLanguage)) {
      let lang = m[1]
      if (lang === 'jsx' || lang === 'tsx') {
        activated.add('xml')
      }
      if (lang in languageAlias) {
        lang = (languageAlias as any)[lang]
      }
      if (languages.has(lang)) {
        activated.add(lang)
      }
    }
    activated.forEach(lang => {
      extra.push(
        `import ${lang} from '${hljsUri}/lib/languages/${lang}'`,
        `hljs.registerLanguage('${lang}', ${lang})`
      )
    })
    code.splice(6, 0, `    ref,`)
    code.splice(3, 0, ...hooks)
    code.unshift(...extra, `import '${hljsUri}/styles/${highlight.theme || 'default'}.css'`)
  }

  if (framework === 'react') {
    return {
      code: code.join('\n')
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
