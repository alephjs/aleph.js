declare type AlephConfig = {
  routes?: string;
};

declare type Context<Data = Record<string, any>, Env = Record<string, string>> =
  {
    env: Env;
    data: Data;
  };

declare type SSREvent = {
  url: URL;
  headCollection: string[];
  data?: any;
  dataExpires?: number;
};

declare type URLPattern = {
  exec(
    location: { pathname: string },
  ): null | { pathname: { groups: Record<string, string>; input: string } };
};
