declare type AlephConfig = {
  readonly routes?: string;
};

declare type Context<Data = Record<string, any>, Env = Record<string, string>> = {
  readonly config: AlephConfig;
  readonly env: Env;
  readonly data: Data;
};

declare type SSREvent = {
  readonly url: URL;
  readonly headCollection: string[];
  readonly data?: any;
  readonly dataExpires?: number;
};

declare class URLPattern {
  constructor(init?: URLPatternInit | string, baseURL?: string);
  test(input?: string | URLPatternInit, baseURL?: string): boolean;
  exec(input?: string | URLPatternInit, baseURL?: string): URLPatternResult | null | undefined;
  get protocol(): any;
  get username(): any;
  get password(): any;
  get hostname(): any;
  get port(): any;
  get pathname(): any;
  get search(): any;
  get hash(): any;
}

declare interface URLPatternInit {
  baseURL?: string;
  username?: string;
  password?: string;
  protocol?: string;
  hostname?: string;
  port?: string;
  pathname?: string;
  search?: string;
  hash?: string;
}

declare interface URLPatternResult {
  inputs: [URLPatternInit | string];
  protocol: URLPatternComponentResult;
  username: URLPatternComponentResult;
  password: URLPatternComponentResult;
  hostname: URLPatternComponentResult;
  port: URLPatternComponentResult;
  pathname: URLPatternComponentResult;
  search: URLPatternComponentResult;
  hash: URLPatternComponentResult;
}

declare interface URLPatternComponentResult {
  input: string;
  groups: {
    [key: string]: string;
  };
}
