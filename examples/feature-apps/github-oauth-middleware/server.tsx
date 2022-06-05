import presetUno from "@unocss/preset-uno.ts";
import { App } from "aleph/react";
import { serve } from "aleph/server";
import { renderToReadableStream } from "react-dom/server";
import { GithubOauth } from "./oauth.ts";

serve({
  routes: "./routes/**/*.{tsx,ts}",
  unocss: {
    presets: [
      presetUno(),
    ],
  },
  middlewares: [
    new GithubOauth({
      clientId: Deno.env.get("GITHUB_OAUTH_CLIENT_ID"),
      clientSecret: Deno.env.get("GITHUB_OAUTH_CLIENT_SECRET"),
    }),
  ],
  ssr: {
    // when set `dataDefer` to `true`, the router will loading data as defer
    // please check https://alephjs.org/docs/react/router/data-defer
    dataDefer: false,
    render: (ctx) => renderToReadableStream(<App ssrContext={ctx} />, ctx),
  },
});
