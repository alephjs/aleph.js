import { basename, resolve } from "https://deno.land/std@0.144.0/path/mod.ts";
import log, { blue } from "../lib/log.ts";
import { serve as httpServe } from "../lib/serve.ts";
import { watchFS } from "../server/dev.ts";
import { builtinModuleExts, findFile, initModuleLoaders, loadImportMap } from "../server/helpers.ts";
import { serve } from "../server/mod.ts";
import { proxyModules } from "../server/proxy_modules.ts";
import { createFsEmitter } from "../server/watch_fs.ts";

if (import.meta.main) {
  // add envs
  Deno.env.set("ALEPH_CLI", "true");
  Deno.env.set("ALEPH_ENV", "development");

  // set log level to 'debug' when in aleph framework dev mode
  if (Deno.env.get("ALEPH_DEV")) {
    log.setLevel("debug");
  }

  // serve app modules
  const importMap = await loadImportMap();
  const moduleLoaders = await initModuleLoaders(importMap);
  await proxyModules(6060, { importMap, moduleLoaders });
  const [denoConfigFile, importMapFile, serverEntry, buildScript] = await Promise.all([
    findFile(["deno.jsonc", "deno.json", "tsconfig.json"]),
    findFile(["import_map", "import-map", "importmap", "importMap"].map((v) => `${v}.json`)),
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

  let ac: AbortController | null = null;
  const start = async () => {
    if (ac) {
      ac.abort();
      log.info(`Restart server...`);
    }
    ac = new AbortController();
    await bootstrap(ac.signal, serverEntry);
  };

  if (serverEntry) {
    const emitter = createFsEmitter();
    emitter.on(`hotUpdate:./${basename(serverEntry)}`, start);
    if (denoConfigFile) {
      emitter.on(`modify:./${basename(denoConfigFile)}`, start);
    }
    if (importMapFile) {
      emitter.on(`modify:./${basename(importMapFile)}`, async () => {
        // update import maps for `proxyModules`
        Object.assign(importMap, await loadImportMap());
        start();
      });
    }
  }

  watchFS();
  await start();
}

async function bootstrap(signal: AbortSignal, entry: string | undefined, fixedPort?: number): Promise<void> {
  // clean globally cached objects
  Reflect.deleteProperty(globalThis, "__ALEPH_SERVER");
  Reflect.deleteProperty(globalThis, "__ALEPH_INDEX_HTML");
  Reflect.deleteProperty(globalThis, "__UNO_GENERATOR");

  if (entry) {
    const entryName = basename(entry);
    await import(
      `http://localhost:${Deno.env.get("ALEPH_MODULES_PROXY_PORT")}/${entryName}?t=${Date.now().toString(16)}`
    );
    if (Deno.env.get("ALEPH_SERVER_ENTRY") !== entryName) {
      Deno.env.set("ALEPH_SERVER_ENTRY", entryName);
      log.info(`Bootstrap server from ${blue(entryName)}...`);
    }
  }

  // make the default handler
  if (!Reflect.has(globalThis, "__ALEPH_SERVER")) {
    console.warn("No server entry found");
    serve();
  }

  const { port: userPort, hostname, certFile, keyFile, handler } = Reflect.get(globalThis, "__ALEPH_SERVER") || {};
  const port = fixedPort || userPort || 8080;
  try {
    await httpServe({
      port,
      hostname,
      certFile,
      keyFile,
      signal,
      onListenSuccess: (port) => log.info(`Server ready on http://localhost:${port}`),
      handler,
    });
  } catch (error) {
    if (error instanceof Deno.errors.AddrInUse) {
      log.warn(`Port ${port} is in use, try ${port + 1}...`);
      await bootstrap(signal, entry, port + 1);
    } else {
      throw error;
    }
  }
}
