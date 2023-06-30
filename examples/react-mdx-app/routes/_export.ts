/** @format */

// Exports router modules for serverless env that doesn't support the dynamic import.
// This module will be updated automaticlly in develoment mode, do NOT edit it manually.
// deno-fmt-ignore-file
// deno-lint-ignore-file
// @ts-nocheck
var u = Object.defineProperty;
var c = (s, e) => {
	for (var o in e) u(s, o, { get: e[o], enumerable: !0 });
};
import * as y from "./_404.tsx";
import * as k from "./_app.tsx";
import * as v from "./index.tsx";
import * as A from "./docs.tsx";
var t = {};
c(t, { default: () => b });
import {
	Fragment as g,
	jsx as r,
	jsxs as i,
} from "https://esm.sh/react@18.2.0/jsx-runtime";
import { useMDXComponents as h } from "https://esm.sh/v126/@mdx-js/react@2.3.0";
import { Head as j } from "aleph/react";
function d(s) {
	let e = Object.assign(
		{ h1: "h1", p: "p", code: "code", pre: "pre" },
		h(),
		s.components
	);
	return i(g, {
		children: [
			r(j, { children: r("title", { children: "Get Started - Docs" }) }),
			`
`,
			r(e.h1, { id: "get-started", children: "Get Started" }),
			`
`,
			i(e.p, {
				children: [
					"Initialize a new project, you can pick a start template with ",
					r(e.code, { children: "--template" }),
					` flag, available templates:
`,
					r(e.code, { children: "[react, vue, api, yew]" }),
				],
			}),
			`
`,
			r(e.pre, {
				children: r(e.code, {
					className: "hljs language-bash",
					children: `deno run -A https://deno.land/x/aleph@1.0.0-beta.18/init.ts
`,
				}),
			}),
		],
	});
}
function f(s = {}) {
	let { wrapper: e } = Object.assign({}, h(), s.components);
	return e ? r(e, Object.assign({}, s, { children: r(d, s) })) : d(s);
}
var b = f;
var l = {};
c(l, { default: () => x });
import {
	Fragment as N,
	jsx as n,
	jsxs as a,
} from "https://esm.sh/react@18.2.0/jsx-runtime";
import { useMDXComponents as p } from "https://esm.sh/v126/@mdx-js/react@2.3.0";
import { Head as w } from "aleph/react";
function m(s) {
	let e = Object.assign(
		{
			h1: "h1",
			p: "p",
			strong: "strong",
			a: "a",
			blockquote: "blockquote",
			em: "em",
			code: "code",
			pre: "pre",
			span: "span",
		},
		p(),
		s.components
	);
	return a(N, {
		children: [
			n(w, { children: n("title", { children: "About - Docs" }) }),
			`
`,
			n(e.h1, { id: "about", children: "About" }),
			`
`,
			a(e.p, {
				children: [
					n(e.strong, { children: "Aleph.js" }),
					" (or ",
					n(e.strong, { children: "Aleph" }),
					" or ",
					n(e.strong, { children: "\u05D0" }),
					" or ",
					n(e.strong, { children: "\u963F\u83B1\u592B" }),
					", ",
					n("samp", { children: "\u02C8\u0251\u02D0l\u025Bf" }),
					`) is a
fullstack framework in `,
					n(e.a, { href: "https://deno.land", children: "Deno" }),
					". Inspired by ",
					n(e.a, { href: "https://nextjs.org", children: "Next.js" }),
					", ",
					n(e.a, { href: "https://remix.run", children: "Remix" }),
					" and ",
					n(e.a, { href: "https://vitejs.dev", children: "Vite" }),
					".",
				],
			}),
			`
`,
			a(e.blockquote, {
				children: [
					`
`,
					a(e.p, {
						children: [
							"The name is taken from the book ",
							n(e.a, {
								href: "http://phinnweb.org/links/literature/borges/aleph.html",
								children: n(e.em, { children: "The Aleph" }),
							}),
							" by ",
							n(e.strong, { children: "Jorge Luis Borges" }),
							".",
						],
					}),
					`
`,
				],
			}),
			`
`,
			a(e.p, {
				children: [
					"Aleph.js is modern framework that doesn't need ",
					n(e.strong, { children: "webpack" }),
					` or other bundler
since it uses the `,
					n(e.a, {
						href: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules",
						children: "ES Module",
					}),
					` syntax during development. Every module only needs
to be compiled once, when a module changes, Aleph.js just needs to re-compile
that single module. There is no time wasted `,
					n(e.em, { children: "re-bundling" }),
					` everytime a change is
made. This, along with Hot Module Replacement (`,
					n(e.strong, { children: "HMR" }),
					") and ",
					n(e.strong, { children: "Fast Refresh" }),
					`,
leads to instant updates in the browser.`,
				],
			}),
			`
`,
			a(e.p, {
				children: [
					"Aleph.js uses modern tools to build your app. It transpiles code using ",
					n(e.a, { href: "https://swc.rs", children: "swc" }),
					` in
WASM with high performance, and bundles modules with `,
					n(e.a, {
						href: "https://github.com/evanw/esbuild",
						children: "esbuild",
					}),
					` at optimization
time extremely fast.`,
				],
			}),
			`
`,
			a(e.p, {
				children: [
					"Aleph.js works on top of ",
					n(e.strong, { children: "Deno" }),
					", a ",
					n(e.em, { children: "simple" }),
					", ",
					n(e.em, { children: "modern" }),
					" and ",
					n(e.em, { children: "secure" }),
					` runtime for
JavaScript and TypeScript. All dependencies are imported using URLs, and managed
by Deno cache system. No `,
					n(e.code, { children: "package.json" }),
					" and ",
					n(e.code, { children: "node_modules" }),
					" directory needed.",
				],
			}),
			`
`,
			n(e.pre, {
				children: a(e.code, {
					className: "hljs language-js",
					children: [
						n(e.span, {
							className: "hljs-keyword",
							children: "import",
						}),
						" ",
						n(e.span, {
							className: "hljs-title class_",
							children: "React",
						}),
						" ",
						n(e.span, {
							className: "hljs-keyword",
							children: "from",
						}),
						" ",
						n(e.span, {
							className: "hljs-string",
							children: "'https://esm.sh/react'",
						}),
						`
`,
						n(e.span, {
							className: "hljs-keyword",
							children: "import",
						}),
						" ",
						n(e.span, {
							className: "hljs-title class_",
							children: "Logo",
						}),
						" ",
						n(e.span, {
							className: "hljs-keyword",
							children: "from",
						}),
						" ",
						n(e.span, {
							className: "hljs-string",
							children: "'../components/logo.tsx'",
						}),
						`

`,
						n(e.span, {
							className: "hljs-keyword",
							children: "export",
						}),
						" ",
						n(e.span, {
							className: "hljs-keyword",
							children: "default",
						}),
						" ",
						n(e.span, {
							className: "hljs-keyword",
							children: "function",
						}),
						" ",
						n(e.span, {
							className: "hljs-title function_",
							children: "Home",
						}),
						"(",
						n(e.span, { className: "hljs-params" }),
						`) {
  `,
						n(e.span, {
							className: "hljs-keyword",
							children: "return",
						}),
						` (
    `,
						a(e.span, {
							className: "xml",
							children: [
								a(e.span, {
									className: "hljs-tag",
									children: [
										"<",
										n(e.span, {
											className: "hljs-name",
											children: "div",
										}),
										">",
									],
								}),
								`
      `,
								a(e.span, {
									className: "hljs-tag",
									children: [
										"<",
										n(e.span, {
											className: "hljs-name",
											children: "Logo",
										}),
										" />",
									],
								}),
								`
      `,
								a(e.span, {
									className: "hljs-tag",
									children: [
										"<",
										n(e.span, {
											className: "hljs-name",
											children: "h1",
										}),
										">",
									],
								}),
								"Hello World!",
								a(e.span, {
									className: "hljs-tag",
									children: [
										"</",
										n(e.span, {
											className: "hljs-name",
											children: "h1",
										}),
										">",
									],
								}),
								`
    `,
								a(e.span, {
									className: "hljs-tag",
									children: [
										"</",
										n(e.span, {
											className: "hljs-name",
											children: "div",
										}),
										">",
									],
								}),
							],
						}),
						`
  )
}
`,
					],
				}),
			}),
		],
	});
}
function _(s = {}) {
	let { wrapper: e } = Object.assign({}, p(), s.components);
	return e ? n(e, Object.assign({}, s, { children: n(m, s) })) : m(s);
}
var x = _;
var O = {
	"/_404": y,
	"/_app": k,
	"/": v,
	"/docs": A,
	"/docs/get-started": t,
	"/docs/index": l,
	depGraph: {
		modules: [
			{ specifier: "./routes/docs/get-started.mdx" },
			{ specifier: "./routes/docs/index.mdx" },
		],
	},
};
export { O as default };
