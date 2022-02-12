export type AlephConfig = {
  routes?: string;
};

export type AlephJsxConfig = {
  readonly runtime?: "react" | "preact";
  readonly importSource?: string;
  readonly magic?: boolean;
};

export type Context<Data = Record<string, any>, Env = Record<string, string>> = {
  readonly config: Readonly<AlephConfig> & AlephJsxConfig;
  readonly env: Env;
  readonly data: Data;
};

export type SSREvent = {
  readonly url: URL;
  readonly headCollection: string[];
  readonly component?: any;
  readonly data?: any;
  readonly dataExpires?: number;
};

export type RouteConfig = [
  { exec(input: { pathname: string }): { pathname: { groups: Record<string, string> } } }, // URLPattern
  () => Promise<{ component?: CallableFunction | object; data?: Record<string, any> }>,
];
