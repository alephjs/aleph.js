import { renderToWebStream } from "@vue/server-renderer";
import type { SSRContext } from "../../server/types.ts";
import { App, createSSRApp } from "./router.ts";

const render = (ctx: SSRContext) => renderToWebStream(createSSRApp(App, { ssrContext: ctx }), ctx);

export default render;
