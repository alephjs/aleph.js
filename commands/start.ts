import { basename, join } from "https://deno.land/std@0.135.0/path/mod.ts";
import { serve as stdServe, serveTls } from "https://deno.land/std@0.135.0/http/server.ts";
import { findFile } from "../lib/fs.ts";
import { builtinModuleExts } from "../lib/helpers.ts";
import log, { blue } from "../lib/log.ts";
import { initModuleLoaders, loadImportMap } from "../server/config.ts";
import { build } from "../server/build.ts";
import { serve } from "../server/mod.ts";
import { proxyModules } from "../server/proxy_modules.ts";
import type { AlephConfig } from "../server/types.ts";

if (import.meta.main) {
  // add envs
  Deno.env.set("ALEPH_CLI", "true");
  Deno.env.set("ALEPH_ENV", "prouduction");

  // set log level from flags `--log-level=[debug|info]`
  log.setLevelFromFlag();

  // serve app modules
  const ac = new AbortController();
  const importMap = await loadImportMap();
  const moduleLoaders = await initModuleLoaders(importMap);
  proxyModules(6060, { importMap, moduleLoaders, signal: ac.signal });

  let serverEntry = await findFile(builtinModuleExts.map((ext) => `server.${ext}`));
  if (serverEntry) {
    await import(
      `http://localhost:${Deno.env.get("ALEPH_MODULES_PROXY_PORT")}/${basename(serverEntry)}?t=${
        Date.now().toString(16)
      }`
    );
  }

  // make the default handler
  if (!Reflect.has(globalThis, "__ALEPH_SERVER")) {
    serverEntry = undefined;
    serve();
  }

  log.info("Building...");
  const { clientModules } = await build(serverEntry);
  log.info(`${clientModules.size} client modules built`);

  // close the app modules server
  ac.abort();

  const config: AlephConfig | undefined = Reflect.get(globalThis, "__ALEPH_CONFIG");
  const outputDir = config?.build?.outputDir ?? "dist";
  const distServerEntry = "file://" + join(Deno.cwd(), outputDir, "server.js");
  await import(distServerEntry);
  log.info(`Bootstrap server from ${blue(join(outputDir, "server.js"))}...`);

  const { hostname, port = 8080, certFile, keyFile, handler } = Reflect.get(globalThis, "__ALEPH_SERVER") || {};

  log.info(`Server ready on http://localhost:${port}`);
  if (certFile && keyFile) {
    await serveTls(handler, { port, hostname, certFile, keyFile });
  } else {
    await stdServe(handler, { port, hostname });
  }
}
