import { createElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import type { SSRContext } from "../../server/types.ts";
import { App } from "./router.ts";

const render = (ctx: SSRContext) => {
  return renderToReadableStream(createElement(App, { ssrContext: ctx }), ctx);
};

export default render;
