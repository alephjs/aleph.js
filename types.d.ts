declare type AlephConfig = {
  routes?: string;
};

declare type AlephJsxConfig = {
  readonly runtime?: "react" | "preact";
  readonly importSource?: string;
  readonly magic?: boolean;
};

declare type Context<Data = Record<string, any>, Env = Record<string, string>> = {
  readonly config: Readonly<AlephConfig> & AlephJsxConfig;
  readonly env: Env;
  readonly data: Data;
};

declare type SSREvent = {
  readonly url: URL;
  readonly headCollection: string[];
  readonly component?: any;
  readonly data?: any;
  readonly dataExpires?: number;
};
