export type AlephConfig = {
  routes?: string;
  jsxMagic?: boolean;
};

export type AlephJSXConfig = {
  jsxRuntime?: "react" | "preact";
  jsxImportSource?: string;
  jsxMagic?: boolean;
};

export type Context<Data = any, Env = any> = {
  readonly env: Env;
  readonly data: Data;
};

export interface IURLPattern {
  exec(input: { host?: string; pathname: string }): {
    pathname: { groups: Record<string, string> };
  };
}

export type RouteConfig = [
  IURLPattern,
  () => Promise<{ component?: CallableFunction | object; data?: Record<string, any> }>,
];

export type Fetcher = {
  (request: Request, context: Context): Promise<Response | void> | Response | void;
};

export type Middleware = Fetcher | { fetch: Fetcher };
