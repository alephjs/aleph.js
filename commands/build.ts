import { basename } from "https://deno.land/std@0.135.0/path/mod.ts";
import { findFile } from "../lib/fs.ts";
import { builtinModuleExts } from "../lib/helpers.ts";
import log, { blue, bold } from "../lib/log.ts";
import { initModuleLoaders, loadImportMap } from "../server/config.ts";
import { build } from "../server/build.ts";
import { serve } from "../server/mod.ts";
import { proxyModules } from "../server/proxy_modules.ts";

if (import.meta.main) {
  // add envs
  Deno.env.set("ALEPH_CLI", "true");
  Deno.env.set("ALEPH_ENV", "prouduction");

  // set log level from flags `--log-level=[debug|info]`
  log.setLevelFromFlag();

  // serve app modules
  const importMap = await loadImportMap();
  const moduleLoaders = await initModuleLoaders(importMap);
  proxyModules(6060, { importMap, moduleLoaders });

  let serverEntry = await findFile(builtinModuleExts.map((ext) => `server.${ext}`));
  if (serverEntry) {
    await import(
      `http://localhost:${Deno.env.get("ALEPH_MODULES_PROXY_PORT")}/${basename(serverEntry)}?t=${
        Date.now().toString(16)
      }`
    );
    log.info(`Build server from ${blue(basename(serverEntry))}`);
  }

  // make the default handler
  if (!Reflect.has(globalThis, "__ALEPH_SERVER")) {
    serverEntry = undefined;
    serve();
  }

  const start = performance.now();
  const { clientModules, routeFiles } = await build(serverEntry);

  log.info(`${bold(routeFiles.length.toString(10))} routes found`);
  log.info(`${bold(clientModules.size.toString(10))} client modules built`);
  log.info(`Done in ${(performance.now() - start)}ms`);
  Deno.exit(0);
}
