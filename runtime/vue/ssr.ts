import { renderToWebStream } from "@vue/server-renderer";
import type { SSRContext } from "../../server/types.ts";
import { createApp } from "./router.ts";

const render = (ctx: SSRContext) => renderToWebStream(createApp({ ssrContext: ctx }), ctx);

export default render;
