export type AlephConfig = {
  routes?: string;
  jsxMagic?: boolean;
};

export type AlephJSXConfig = {
  jsxRuntime?: "react" | "preact";
  jsxImportSource?: string;
  jsxMagic?: boolean;
};

export interface IURLPattern {
  exec(input: { host?: string; pathname: string }): {
    pathname: { groups: Record<string, string> };
  };
}

export type RouteConfig = [
  IURLPattern,
  () => Promise<{ component?: unknown; dataMethods?: Record<string, any> }>,
  { pattern: { pathname: string }; filename: string },
];

export type Fetcher = {
  (request: Request, context: any): Promise<Response | void> | Response | void;
};

export type Middleware = Fetcher | { fetch: Fetcher };

export type SSREvent = {
  readonly url: URL;
  readonly headCollection: string[];
  readonly component?: any;
  readonly data?: any;
  readonly dataExpires?: number;
};
