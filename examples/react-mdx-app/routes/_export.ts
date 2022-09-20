// Imports route modules for serverless env that doesn't support the dynamic import.
// This module will be updated automaticlly in develoment mode, do NOT edit it manually.
// deno-fmt-ignore-file
// deno-lint-ignore-file
// @ts-nocheck
var b=Object.defineProperty;var c=(t,e)=>{for(var h in e)b(t,h,{get:e[h],enumerable:!0})};import*as S from"./_404.tsx";import*as v from"./_app.tsx";import*as C from"./index.tsx";import*as O from"./docs.tsx";var a={};c(a,{default:()=>_});import{Fragment as x,jsx as i,jsxs as m}from"https://esm.sh/react@18.2.0/jsx-runtime";import{Head as j}from"aleph/react";function p(t){let e=Object.assign({h1:"h1",p:"p",code:"code",pre:"pre"},t.components);return m(x,{children:[i(j,{children:i("title",{children:"Get Started - Docs"})}),`
`,i(e.h1,{children:"Get Started"}),`
`,m(e.p,{children:["Initialize a new project, you can pick a start template with ",i(e.code,{children:"--template"}),` flag, available templates:
`,i(e.code,{children:"[react, vue, api, yew]"})]}),`
`,i(e.pre,{children:i(e.code,{className:"language-bash",children:`deno run -A https://deno.land/x/aleph@1.0.0-beta.10/init.ts
`})})]})}function w(t={}){let{wrapper:e}=t.components||{};return e?i(e,Object.assign({},t,{children:i(p,t)})):p(t)}var _=w;var d={};c(d,{default:()=>D});import{Fragment as k,jsx as n,jsxs as o}from"https://esm.sh/react@18.2.0/jsx-runtime";import{Link as u,Head as y}from"aleph/react";function g(t){let e=Object.assign({h1:"h1",ul:"ul",li:"li",h3:"h3",h4:"h4",p:"p",a:"a",del:"del",table:"table",thead:"thead",tr:"tr",th:"th",input:"input"},t.components);return o(k,{children:[n(y,{children:n("title",{children:"Index - Docs"})}),`
`,n(e.h1,{children:"Docs Index"}),`
`,o(e.ul,{children:[`
`,o(e.li,{children:[`
`,n(u,{to:"/docs/about",children:"About"}),`
`]}),`
`,o(e.li,{children:[`
`,n(u,{to:"/docs/get-started",children:"Get started"}),`
`]}),`
`]}),`
`,n(e.h3,{children:"Support GFM"}),`
`,n(e.h4,{children:"Autolink literals"}),`
`,o(e.p,{children:[n(e.a,{href:"http://www.example.com",children:"www.example.com"}),", ",n(e.a,{href:"https://example.com",children:"https://example.com"}),", and ",n(e.a,{href:"mailto:contact@example.com",children:"contact@example.com"}),"."]}),`
`,n(e.h4,{children:"Strikethrough"}),`
`,o(e.p,{children:[n(e.del,{children:"one"})," or ",n(e.del,{children:"two"})," tildes."]}),`
`,n(e.h4,{children:"Table"}),`
`,n(e.table,{children:n(e.thead,{children:o(e.tr,{children:[n(e.th,{children:"a"}),n(e.th,{align:"left",children:"b"}),n(e.th,{align:"right",children:"c"}),n(e.th,{align:"center",children:"d"})]})})}),`
`,n(e.h4,{children:"Tasklist"}),`
`,o(e.ul,{className:"contains-task-list",children:[`
`,o(e.li,{className:"task-list-item",children:[n(e.input,{type:"checkbox",disabled:!0})," ","to do"]}),`
`,o(e.li,{className:"task-list-item",children:[n(e.input,{type:"checkbox",checked:!0,disabled:!0})," ","done"]}),`
`]})]})}function A(t={}){let{wrapper:e}=t.components||{};return e?n(e,Object.assign({},t,{children:n(g,t)})):g(t)}var D=A;var s={};c(s,{default:()=>H});import{Fragment as M,jsx as r,jsxs as l}from"https://esm.sh/react@18.2.0/jsx-runtime";import{Head as L}from"aleph/react";function f(t){let e=Object.assign({h1:"h1",p:"p",strong:"strong",code:"code",a:"a",blockquote:"blockquote"},t.components);return l(M,{children:[r(L,{children:r("title",{children:"About - Docs"})}),`
`,r(e.h1,{children:"About"}),`
`,l(e.p,{children:[r(e.strong,{children:"Aleph.js"})," (or ",r(e.strong,{children:"Aleph"})," or ",r(e.strong,{children:"\u05D0"})," or ",r(e.strong,{children:"\u963F\u83B1\u592B"}),", ",r(e.code,{children:"\u02C8\u0251\u02D0l\u025Bf"}),") is a fullstack framework in ",r(e.a,{href:"https://deno.land",children:"Deno"}),"."]}),`
`,l(e.blockquote,{children:[`
`,r(e.p,{children:"The name is taken from the book The Aleph by Jorge Luis Borges."}),`
`]}),`
`,r(e.p,{children:"Aleph.js is a module framework that doesn't need webpack or other bundler since it uses the [ES Module] syntax during development. Every module only needs to be compiled once. When a module changes, Aleph.js just needs to re-compile that single module. There is no time wasted re-bundling everytime a change is made. This, along with Hot Module Replacement (HMR) and Fast Refresh, leads to instant updates in the browser."}),`
`,l(e.p,{children:["Aleph.js uses modern tools to build your app. It transpiles code using ",r(e.a,{href:"https://swc.rs",children:"swc"})," in WASM with high performance, and bundles modules with ",r(e.a,{href:"https://github.com/evanw/esbuild",children:"esbuild"})," at build time extremely fast."]}),`
`,l(e.p,{children:["Aleph.js works on top of Deno, a simple, modern and secure runtime for JavaScript and TypeScript. All dependencies are imported using URLs, and managed by Deno cache system. No ",r(e.code,{children:"package.json"})," and ",r(e.code,{children:"node_modules"})," directory needed."]})]})}function F(t={}){let{wrapper:e}=t.components||{};return e?r(e,Object.assign({},t,{children:r(f,t)})):f(t)}var H=F;var I={"/_404":S,"/_app":v,"/":C,"/docs":O,"/docs/get-started":a,"/docs/index":d,"/docs/about":s,depGraph:{"modules":[{"specifier":"./routes/docs/get-started.mdx"},{"specifier":"./routes/docs/index.mdx"},{"specifier":"./routes/docs/about.mdx"}]}};export{I as default};
