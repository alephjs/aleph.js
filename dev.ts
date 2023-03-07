import dev from "./server/dev.ts";

if (import.meta.main) {
  const generateExportTs = Deno.args.includes("--generate");
  dev({ generateExportTs });
}
