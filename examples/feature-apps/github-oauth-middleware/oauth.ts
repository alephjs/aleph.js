export type GithubUser = {
  id: number;
  login: string;
  avatar_url: string;
  name: string;
};

export type GithubOauthConfig = {
  clientId?: string;
  clientSecret?: string;
};

export class GithubOauth implements Middleware {
  readonly name: string = "github-oauth";

  #config: GithubOauthConfig;

  constructor(config: GithubOauthConfig) {
    this.#config = config;
  }

  async fetch(req: Request, ctx: Context) {
    const { pathname, searchParams } = new URL(req.url);
    const session = await ctx.getSession<{ user: GithubUser }>();

    if (pathname === "/logout") {
      return session.end("/");
    }

    if (!session.store?.user) {
      const code = searchParams.get("code");
      if (!code) {
        const loginUrl =
          `https://github.com/login/oauth/authorize?client_id=${this.#config.clientId}&scope=read:user+user:email`;
        return new Response("Not logged in", {
          status: 302,
          headers: { Location: loginUrl },
        });
      }

      const ret: { access_token: string; error?: string } = await fetch(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          body: JSON.stringify({
            client_id: this.#config.clientId,
            client_secret: this.#config.clientSecret,
            state: searchParams.get("state") || undefined,
            code,
          }),
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
          },
        },
      ).then((res) => res.json());
      if (ret.error) {
        return new Response(ret.error, { status: 500 });
      }

      const user: GithubUser = await fetch("https://api.github.com/user", {
        headers: {
          "Authorization": `token ${ret.access_token}`,
          "Accept": "application/json",
        },
      }).then((res) => res.json());

      return session.update(
        { user },
        searchParams.get("redirect") ?? "/",
      );
    }

    ctx.user = session.store.user;
  }
}
