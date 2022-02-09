declare type Context<Data = Record<string, any>, Env = Record<string, string>> = {
  env: Env
  data: Data
}

declare type SSREvent = {
  url: URL,
  headCollection: string[],
  data?: any,
  dataExpires?: number
}
