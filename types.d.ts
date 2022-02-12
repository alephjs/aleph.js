declare type Context<Data = Record<string, any>, Env = Record<string, string>> = {
  readonly env: Env;
  readonly data: Data;
};
