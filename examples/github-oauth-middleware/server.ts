import { serve } from "aleph/react-server";
import unocss from "aleph/plugins/unocss";
import presetUno from "@unocss/preset-uno";
import { GithubOauth } from "./middlewares/oauth.ts";
import routes from "./routes/_export.ts";

serve({
  baseUrl: import.meta.url,
  router: { routes },
  plugins: [
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
  ssr: true,
});
