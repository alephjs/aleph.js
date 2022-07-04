import presetUno from "@unocss/preset-uno.ts";
import { serve } from "aleph/server";
import ssr from "aleph/react-ssr";
import { GithubOauth } from "./oauth.ts";

// pre-import route modules
import routeModules from "./routes/_export.ts";

serve({
  baseUrl: import.meta.url,
  routes: "./routes/**/*.{tsx,ts}",
  routeModules,
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
  ssr,
});
