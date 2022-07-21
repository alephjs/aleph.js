import { serve } from "aleph/server";
import ssr from "aleph/react-ssr";
import { GithubOauth } from "./oauth.ts";
import routes from "./routes/_export.ts";

serve({
  baseUrl: import.meta.url,
  router: {
    glob: "./routes/**/*.{tsx,ts}",
    routes,
  },
  unocss: "preset",
  middlewares: [
    new GithubOauth({
      clientId: Deno.env.get("GITHUB_OAUTH_CLIENT_ID"),
      clientSecret: Deno.env.get("GITHUB_OAUTH_CLIENT_SECRET"),
    }),
  ],
  ssr,
  dev: {
    reactRefresh: true,
  },
});
