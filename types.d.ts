export type AlephConfig = {
  routeFiles?: string;
  windicss?: boolean;
};

export type JSXConfig = {
  jsxRuntime?: "react" | "preact";
  jsxImportSource?: string;
};

export interface IURLPattern {
  exec(input: { host?: string; pathname: string }): {
    host: { groups: Record<string, string> };
    pathname: { groups: Record<string, string> };
  };
}

export type RouteConfig = [
  IURLPattern,
  () => Promise<{ default?: unknown; data?: Record<string, any> }>,
  { filename: string; pattern: { host?: string; pathname: string } },
];

export type Fetcher = {
  (request: Request, context: any): Promise<Response | void> | Response | void;
};

export type Middleware = Fetcher | { fetch: Fetcher };

export type SSREvent = {
  readonly url: URL;
  readonly headCollection: string[];
  readonly moduleDefaultExport?: any;
  readonly data?: any;
  readonly dataExpires?: number;
};
