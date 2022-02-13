export type AlephConfig = {
  routes?: string;
  jsxMagic?: boolean;
};

export type AlephJSXConfig = {
  jsxRuntime?: "react" | "preact";
  jsxImportSource?: string;
  jsxMagic?: boolean;
};

export type Context<Data = Record<string, any>, Env = Record<string, string>> = {
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
