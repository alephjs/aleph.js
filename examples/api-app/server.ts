import { serve } from "aleph/server";
import denoDeploy from "aleph/plugins/deploy";
import modules from "./routes/_export.ts";

declare global {
  interface Context {
    foo: string;
  }
}

serve({
  plugins: [
    denoDeploy({ modules }),
  ],
  middlewares: [
    {
      name: "foo",
      fetch: (_req, ctx) => {
        ctx.foo = "bar";
        return ctx.next();
      },
    },
  ],
});
