import { Plugin } from '../types.ts';

export const defaultMatcher = /{{([^}]*)}}/ig;

type Options = {
  matcher?: string | RegExp,
}
const defaultOptions: Options = {
  matcher: defaultMatcher,
}
const env = (options: Options = defaultOptions): Plugin => ({
  name: 'env',
  test: /\.[tj]s[x]?$/,
  acceptHMR: true,
  async transform(content: Uint8Array) {
    const parameters = Deno.env.toObject();
    const string = (new TextDecoder()).decode(content);
    const code = string
      .replaceAll(options.matcher!, (raw, match) => {
        if (match in parameters) {
          return String(parameters[match]);
        }
        return raw;
      });
    return {
      code,
    }
  }
})

export default env;
