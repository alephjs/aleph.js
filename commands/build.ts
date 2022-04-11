import { basename } from "https://deno.land/std@0.134.0/path/mod.ts";
import { getFlag, parse } from "../lib/flags.ts";
import { findFile } from "../lib/fs.ts";
import { builtinModuleExts } from "../lib/helpers.ts";
import log, { blue } from "../lib/log.ts";
import util from "../lib/util.ts";
import { initModuleLoaders, loadImportMap } from "../server/config.ts";
import { build, type BuildPlatform, supportedPlatforms } from "../server/build.ts";
import { serve } from "../server/mod.ts";
import { serveAppModules } from "../server/serve_modules.ts";

export const helpMessage = `
Usage:
    deno run -A https://deno.land/x/aleph/cli.ts build [...options]

Options:
    -P, --platform  <platform>   Set deploy platform [possible values: deno, cf-worker, vercel]
    -L, --log-level <log-level>  Set log level [possible values: debug, info]
    -h, --help                   Prints help message
`;

if (import.meta.main) {
  const { options } = parse();

  let platform = getFlag(options, ["P", "platform"])?.toLowerCase() as BuildPlatform | undefined;
  if (platform) {
    if (!(platform in supportedPlatforms)) {
      log.fatal(`Unsupported platform: ${platform}`);
    }
  } else {
    const platforms: BuildPlatform[] = ["deno-deploy", "cf-worker", "vercel"];
    Deno.stdout.write(
      util.utf8TextEncoder.encode([
        "Deploy to:",
        "",
        ...platforms.map((id, index) => `  ${index + 1}. ${supportedPlatforms[id]}`),
        "",
        "",
      ].join("\n")),
    );
    while (true) {
      const p = prompt("Select a platform:");
      const n = parseInt(p || "");
      if (util.isInt(n) && n > 0 && n <= platforms.length) {
        platform = platforms[n - 1];
        break;
      }
    }
  }

  // serve app modules
  const importMap = await loadImportMap();
  const moduleLoaders = await initModuleLoaders(importMap);
  serveAppModules(6060, { importMap, moduleLoaders });

  let serverEntry = await findFile(builtinModuleExts.map((ext) => `server.${ext}`));
  if (serverEntry) {
    await import(
      `http://localhost:${Deno.env.get("ALEPH_APP_MODULES_PORT")}/${basename(serverEntry)}?t=${Date.now().toString(16)}`
    );
    log.info(`Server handler imported from ${blue(basename(serverEntry))}`);
  }

  // make the default handler
  if (!Reflect.has(globalThis, "__ALEPH_SERVER_HANDLER")) {
    serverEntry = undefined;
    serve();
  }

  log.info(`Building for ${supportedPlatforms[platform]}...`);

  const start = performance.now();
  const { clientModules } = await build(platform as unknown as "deno-deploy", serverEntry);

  log.info(`${clientModules.size} client modules built`);
  log.info(`Done in ${(performance.now() - start)}ms`);
  Deno.exit(0);
}
