export type GithubOauthConfig = {
  clientId?: string;
  clientSecret?: string;
};

export type GithubUser = {
  id: number;
  login: string;
  avatar_url: string;
  name: string;
};

export class GithubOauth implements Middleware {
  readonly name: string = "github-oauth";

  #config: GithubOauthConfig;

  constructor(config: GithubOauthConfig) {
    this.#config = config;
  }

  async fetch(req: Request, ctx: Context) {
    const { pathname, searchParams } = new URL(req.url);
    const session = await ctx.getSession();

    if (pathname === "/logout") {
      const cookie = await session.end();
      return new Response("", {
        status: 302,
        headers: {
          "Set-Cookie": cookie,
          "Location": "/",
        },
      });
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
          "User-Agent": "Cloudflare/2021-11-10",
        },
      }).then((res) => res.json());

      const cookie = await session.update({ user });
      return new Response("", {
        status: 302,
        headers: {
          "Set-Cookie": cookie,
          "Location": searchParams.get("redirect") ?? "/",
        },
      });
    }

    ctx.user = session.store.user;
  }
}
