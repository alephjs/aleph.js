import dev from "./server/dev.ts";

if (import.meta.main) {
  dev(Deno.args);
}
