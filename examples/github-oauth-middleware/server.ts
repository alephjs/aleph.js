import { serve } from "aleph/server";
import react from "aleph/plugins/react";
import unocss from "aleph/plugins/unocss";
import presetUno from "@unocss/preset-uno";
import { GithubOauth } from "./middlewares/oauth.ts";
import routes from "./routes/_export.ts";

serve({
  baseUrl: import.meta.url,
  router: { routes },
  plugins: [
    react({ ssr: true }),
    unocss({
      presets: [presetUno()],
    }),
  ],
  middlewares: [
    new GithubOauth({
      clientId: Deno.env.get("GITHUB_OAUTH_CLIENT_ID"),
      clientSecret: Deno.env.get("GITHUB_OAUTH_CLIENT_SECRET"),
    }),
  ],
});
