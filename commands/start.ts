import { basename, join, resolve } from "https://deno.land/std@0.136.0/path/mod.ts";
import { serve as stdServe, serveTls } from "https://deno.land/std@0.136.0/http/server.ts";
import { findFile } from "../lib/fs.ts";
import log, { blue } from "../lib/log.ts";
import { build } from "../server/build.ts";
import { builtinModuleExts, initModuleLoaders, loadImportMap } from "../server/helpers.ts";
import { serve } from "../server/mod.ts";
import { proxyModules } from "../server/proxy_modules.ts";
import type { AlephConfig } from "../server/types.ts";

if (import.meta.main) {
  // add envs
  Deno.env.set("ALEPH_CLI", "true");
  Deno.env.set("ALEPH_ENV", "production");

  // set log level to 'debug' when in aleph framework dev mode
  if (Deno.env.get("ALEPH_DEV")) {
    log.setLevel("debug");
  }

  // serve app modules
  const ac = new AbortController();
  const importMap = await loadImportMap();
  const moduleLoaders = await initModuleLoaders(importMap);
  await proxyModules(6060, { importMap, moduleLoaders, signal: ac.signal });

  let [serverEntry, buildScript] = await Promise.all([
    findFile(builtinModuleExts.map((ext) => `server.${ext}`)),
    findFile(builtinModuleExts.map((ext) => `build.${ext}`)),
  ]);

  if (buildScript) {
    log.info(`Running ${blue(basename(buildScript))}...`);
    const { default: build } = await import(`file://${resolve(buildScript)}`);
    await build();
  }

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
  Deno.env.delete("ALEPH_MODULES_PROXY_PORT");

  const config: AlephConfig | undefined = Reflect.get(globalThis, "__ALEPH_CONFIG");
  const outputDir = config?.build?.outputDir ?? "dist";
  const distServerEntry = "file://" + join(Deno.cwd(), outputDir, "server.js");
  await import(distServerEntry);
  log.info(`Bootstrap server from ${blue(join(outputDir, "server.js"))}...`);

  const { hostname, port = 8080, certFile, keyFile, signal, handler } = Reflect.get(globalThis, "__ALEPH_SERVER") || {};
  log.info(`Server ready on http://localhost:${port}`);
  if (certFile && keyFile) {
    await serveTls(handler, { port, hostname, certFile, keyFile, signal });
  } else {
    await stdServe(handler, { port, hostname, signal });
  }
}
