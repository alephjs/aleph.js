// Imports route modules for serverless env that doesn't support the dynamic import.
// This module will be updated automaticlly in develoment mode, do NOT edit it manually.
// deno-fmt-ignore-file
// deno-lint-ignore-file
// @ts-nocheck
var a=Object.defineProperty;var i=(t,o)=>{for(var r in o)a(t,r,{get:o[r],enumerable:!0})};var e={};i(e,{default:()=>m});import{createComponent as u}from"solid-js/web";import{ssr as n}from"solid-js/web";import{escape as s}from"solid-js/web";import{ssrHydrationKey as p}from"solid-js/web";import{createSignal as f}from"solid-js";var _=["<button",' type="button">',"</button>"],c=["<div","><h1>Solid.js + Aleph.js</h1><p>","</p></div>"];function l(){let[t,o]=f(0),r=()=>o(t()+1);return n(_,p(),s(t())+1)}function m(){return n(c,p(),s(u(l,{})))}var E={"/":e,depGraph:{"modules":[{"specifier":"./routes/index.tsx"}]}};export{E as default};
