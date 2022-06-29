import { basename, resolve } from "https://deno.land/std@0.145.0/path/mod.ts";
import log, { blue, bold } from "../lib/log.ts";
import { build } from "../server/build.ts";
import { builtinModuleExts, findFile, initModuleLoaders, loadImportMap } from "../server/helpers.ts";
import { serve } from "../server/mod.ts";
import { proxyModules } from "../server/proxy_modules.ts";

if (import.meta.main) {
  // add envs
  Deno.env.set("ALEPH_CLI", "true");

  // set log level to 'debug' when in aleph framework dev mode
  if (Deno.env.get("ALEPH_DEV")) {
    log.setLevel("debug");
  }

  // serve app modules
  const importMap = await loadImportMap();
  const moduleLoaders = await initModuleLoaders(importMap);
  await proxyModules(6060, { importMap, moduleLoaders });

  let [serverEntry, buildScript] = await Promise.all([
    findFile(builtinModuleExts.map((ext) => `server.${ext}`)),
    findFile(builtinModuleExts.map((ext) => `build.${ext}`)),
  ]);

  if (buildScript) {
    log.info(`Running ${blue(basename(buildScript))}...`);
    const { default: build } = await import(`file://${resolve(buildScript)}`);
    if (typeof build === "function") {
      await build();
    }
  }

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
