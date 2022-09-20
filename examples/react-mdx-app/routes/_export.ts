// Imports route modules for serverless env that doesn't support the dynamic import.
// This module will be updated automaticlly in develoment mode, do NOT edit it manually.
// deno-fmt-ignore-file
// deno-lint-ignore-file
// @ts-nocheck
var b=Object.defineProperty;var i=(n,e)=>{for(var h in e)b(n,h,{get:e[h],enumerable:!0})};import*as C from"./_404.tsx";import*as F from"./_app.tsx";import*as O from"./index.tsx";import*as $ from"./docs.tsx";var d={};i(d,{default:()=>w});import{Fragment as j,jsx as o,jsxs as m}from"https://esm.sh/react@18.2.0/jsx-runtime";import{Head as x}from"aleph/react";function p(n){let e=Object.assign({h1:"h1",p:"p",code:"code",pre:"pre"},n.components);return m(j,{children:[o(x,{children:o("title",{children:"Get Started - Docs"})}),`
`,o(e.h1,{children:"Get Started"}),`
`,m(e.p,{children:["Initialize a new project, you can pick a start template with ",o(e.code,{children:"--template"}),` flag, available templates:
`,o(e.code,{children:"[react, vue, api, yew]"})]}),`
`,o(e.pre,{children:o(e.code,{className:"language-bash",children:`deno run -A https://deno.land/x/aleph@1.0.0-beta.10/init.ts
`})})]})}function _(n={}){let{wrapper:e}=n.components||{};return e?o(e,Object.assign({},n,{children:o(p,n)})):p(n)}var w=_;var c={};i(c,{default:()=>k});import{Fragment as y,jsx as r,jsxs as a}from"https://esm.sh/react@18.2.0/jsx-runtime";import{Link as u,Head as A}from"aleph/react";function f(n){let e=Object.assign({h1:"h1",ul:"ul",li:"li"},n.components);return a(y,{children:[r(A,{children:r("title",{children:"Index - Docs"})}),`
`,r(e.h1,{children:"Docs Index"}),`
`,a(e.ul,{children:[`
`,a(e.li,{children:[`
`,r(u,{to:"/docs/about",children:"About"}),`
`]}),`
`,a(e.li,{children:[`
`,r(u,{to:"/docs/get-started",children:"Get started"}),`
`]}),`
`]})]})}function D(n={}){let{wrapper:e}=n.components||{};return e?r(e,Object.assign({},n,{children:r(f,n)})):f(n)}var k=D;var l={};i(l,{default:()=>v});import{Fragment as M,jsx as t,jsxs as s}from"https://esm.sh/react@18.2.0/jsx-runtime";import{Head as L}from"aleph/react";function g(n){let e=Object.assign({h1:"h1",p:"p",strong:"strong",code:"code",a:"a",blockquote:"blockquote"},n.components);return s(M,{children:[t(L,{children:t("title",{children:"About - Docs"})}),`
`,t(e.h1,{children:"About"}),`
`,s(e.p,{children:[t(e.strong,{children:"Aleph.js"})," (or ",t(e.strong,{children:"Aleph"})," or ",t(e.strong,{children:"\u05D0"})," or ",t(e.strong,{children:"\u963F\u83B1\u592B"}),", ",t(e.code,{children:"\u02C8\u0251\u02D0l\u025Bf"}),") is a fullstack framework in ",t(e.a,{href:"https://deno.land",children:"Deno"}),"."]}),`
`,s(e.blockquote,{children:[`
`,t(e.p,{children:"The name is taken from the book The Aleph by Jorge Luis Borges."}),`
`]}),`
`,t(e.p,{children:"Aleph.js is a module framework that doesn't need webpack or other bundler since it uses the [ES Module] syntax during development. Every module only needs to be compiled once. When a module changes, Aleph.js just needs to re-compile that single module. There is no time wasted re-bundling everytime a change is made. This, along with Hot Module Replacement (HMR) and Fast Refresh, leads to instant updates in the browser."}),`
`,s(e.p,{children:["Aleph.js uses modern tools to build your app. It transpiles code using ",t(e.a,{href:"https://swc.rs",children:"swc"})," in WASM with high performance, and bundles modules with ",t(e.a,{href:"https://github.com/evanw/esbuild",children:"esbuild"})," at build time extremely fast."]}),`
`,s(e.p,{children:["Aleph.js works on top of Deno, a simple, modern and secure runtime for JavaScript and TypeScript. All dependencies are imported using URLs, and managed by Deno cache system. No ",t(e.code,{children:"package.json"})," and ",t(e.code,{children:"node_modules"})," directory needed."]})]})}function H(n={}){let{wrapper:e}=n.components||{};return e?t(e,Object.assign({},n,{children:t(g,n)})):g(n)}var v=H;var P={"/_404":C,"/_app":F,"/":O,"/docs":$,"/docs/get-started":d,"/docs/index":c,"/docs/about":l,depGraph:{"modules":[{"specifier":"./routes/docs/get-started.mdx"},{"specifier":"./routes/docs/index.mdx"},{"specifier":"./routes/docs/about.mdx"}]}};export{P as default};
