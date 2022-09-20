// Imports route modules for serverless env that doesn't support the dynamic import.
// This module will be updated automaticlly in develoment mode, do NOT edit it manually.
// deno-fmt-ignore-file
// deno-lint-ignore-file
// @ts-nocheck
var m=Object.defineProperty;var c=(s,e)=>{for(var o in e)m(s,o,{get:e[o],enumerable:!0})};import*as x from"./_404.tsx";import*as y from"./_app.tsx";import*as _ from"./index.tsx";import*as k from"./docs.tsx";var l={};c(l,{default:()=>j});import{Fragment as p,jsx as r,jsxs as i}from"https://esm.sh/react@18.2.0/jsx-runtime";import{Head as u}from"aleph/react";function d(s){let e=Object.assign({h1:"h1",p:"p",code:"code",pre:"pre"},s.components);return i(p,{children:[r(u,{children:r("title",{children:"Get Started - Docs"})}),`
`,r(e.h1,{children:"Get Started"}),`
`,i(e.p,{children:["Initialize a new project, you can pick a start template with ",r(e.code,{children:"--template"}),` flag, available templates:
`,r(e.code,{children:"[react, vue, api, yew]"})]}),`
`,r(e.pre,{children:r(e.code,{className:"hljs language-bash",children:`deno run -A https://deno.land/x/aleph@1.0.0-beta.10/init.ts
`})})]})}function g(s={}){let{wrapper:e}=s.components||{};return e?r(e,Object.assign({},s,{children:r(d,s)})):d(s)}var j=g;var t={};c(t,{default:()=>w});import{Fragment as f,jsx as n,jsxs as a}from"https://esm.sh/react@18.2.0/jsx-runtime";import{Head as b}from"aleph/react";function h(s){let e=Object.assign({h1:"h1",p:"p",strong:"strong",a:"a",blockquote:"blockquote",em:"em",code:"code",pre:"pre",span:"span"},s.components);return a(f,{children:[n(b,{children:n("title",{children:"About - Docs"})}),`
`,n(e.h1,{children:"About"}),`
`,a(e.p,{children:[n(e.strong,{children:"Aleph.js"})," (or ",n(e.strong,{children:"Aleph"})," or ",n(e.strong,{children:"\u05D0"})," or ",n(e.strong,{children:"\u963F\u83B1\u592B"}),", ",n("samp",{children:"\u02C8\u0251\u02D0l\u025Bf"}),`) is a
fullstack framework in `,n(e.a,{href:"https://deno.land",children:"Deno"}),". Inspired by ",n(e.a,{href:"https://nextjs.org",children:"Next.js"}),", ",n(e.a,{href:"https://remix.run",children:"Remix"})," and ",n(e.a,{href:"https://vitejs.dev",children:"Vite"}),"."]}),`
`,a(e.blockquote,{children:[`
`,a(e.p,{children:["The name is taken from the book ",n(e.a,{href:"http://phinnweb.org/links/literature/borges/aleph.html",children:n(e.em,{children:"The Aleph"})})," by ",n(e.strong,{children:"Jorge Luis Borges"}),"."]}),`
`]}),`
`,a(e.p,{children:["Aleph.js is modern framework that doesn't need ",n(e.strong,{children:"webpack"}),` or other bundler
since it uses the `,n(e.a,{href:"https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules",children:"ES Module"}),` syntax during development. Every module only needs
to be compiled once, when a module changes, Aleph.js just needs to re-compile
that single module. There is no time wasted `,n(e.em,{children:"re-bundling"}),` everytime a change is
made. This, along with Hot Module Replacement (`,n(e.strong,{children:"HMR"}),") and ",n(e.strong,{children:"Fast Refresh"}),`,
leads to instant updates in the browser.`]}),`
`,a(e.p,{children:["Aleph.js uses modern tools to build your app. It transpiles code using ",n(e.a,{href:"https://swc.rs",children:"swc"}),` in
WASM with high performance, and bundles modules with `,n(e.a,{href:"https://github.com/evanw/esbuild",children:"esbuild"}),` at optimization
time extremely fast.`]}),`
`,a(e.p,{children:["Aleph.js works on top of ",n(e.strong,{children:"Deno"}),", a ",n(e.em,{children:"simple"}),", ",n(e.em,{children:"modern"})," and ",n(e.em,{children:"secure"}),` runtime for
JavaScript and TypeScript. All dependencies are imported using URLs, and managed
by Deno cache system. No `,n(e.code,{children:"package.json"})," and ",n(e.code,{children:"node_modules"})," directory needed."]}),`
`,n(e.pre,{children:a(e.code,{className:"hljs language-js",children:[n(e.span,{className:"hljs-keyword",children:"import"})," ",n(e.span,{className:"hljs-title class_",children:"React"})," ",n(e.span,{className:"hljs-keyword",children:"from"})," ",n(e.span,{className:"hljs-string",children:"'https://esm.sh/react'"}),`
`,n(e.span,{className:"hljs-keyword",children:"import"})," ",n(e.span,{className:"hljs-title class_",children:"Logo"})," ",n(e.span,{className:"hljs-keyword",children:"from"})," ",n(e.span,{className:"hljs-string",children:"'../components/logo.tsx'"}),`

`,n(e.span,{className:"hljs-keyword",children:"export"})," ",n(e.span,{className:"hljs-keyword",children:"default"})," ",n(e.span,{className:"hljs-keyword",children:"function"})," ",n(e.span,{className:"hljs-title function_",children:"Home"}),"(",n(e.span,{className:"hljs-params"}),`) {
  `,n(e.span,{className:"hljs-keyword",children:"return"}),` (
    `,a(e.span,{className:"xml",children:[a(e.span,{className:"hljs-tag",children:["<",n(e.span,{className:"hljs-name",children:"div"}),">"]}),`
      `,a(e.span,{className:"hljs-tag",children:["<",n(e.span,{className:"hljs-name",children:"Logo"})," />"]}),`
      `,a(e.span,{className:"hljs-tag",children:["<",n(e.span,{className:"hljs-name",children:"h1"}),">"]}),"Hello World!",a(e.span,{className:"hljs-tag",children:["</",n(e.span,{className:"hljs-name",children:"h1"}),">"]}),`
    `,a(e.span,{className:"hljs-tag",children:["</",n(e.span,{className:"hljs-name",children:"div"}),">"]})]}),`
  )
}
`]})})]})}function N(s={}){let{wrapper:e}=s.components||{};return e?n(e,Object.assign({},s,{children:n(h,s)})):h(s)}var w=N;var L={"/_404":x,"/_app":y,"/":_,"/docs":k,"/docs/get-started":l,"/docs/index":t,depGraph:{"modules":[{"specifier":"./routes/docs/get-started.mdx"},{"specifier":"./routes/docs/index.mdx"}]}};export{L as default};
