// Imports route modules for serverless env that doesn't support the dynamic import.
// This module will be updated automaticlly in develoment mode, do NOT edit it manually.
// deno-fmt-ignore-file
// deno-lint-ignore-file
// @ts-nocheck
var s=Object.defineProperty;var m=(t,o)=>{for(var r in o)s(t,r,{get:o[r],enumerable:!0})};var e={};m(e,{default:()=>n});import{createComponent as p}from"solid-js/web";import{ssr as a}from"solid-js/web";import{escape as u}from"solid-js/web";import{ssrHydrationKey as c}from"solid-js/web";import{createSignal as _}from"solid-js";var i=["<button",' type="button">',"</button>"];function f(){let[t,o]=_(0),r=()=>o(t()+1);return a(i,c(),u(t()))}function n(){return p(f,{})}var A={"/":e,depGraph:{"modules":[{"specifier":"./routes/index.tsx"}]}};export{A as default};
