import { basename } from "https://deno.land/std@0.145.0/path/mod.ts";
import { serve, serveTls } from "https://deno.land/std@0.145.0/http/mod.ts";
import log, { blue } from "../lib/log.ts";
import { builtinModuleExts, findFile } from "../server/helpers.ts";
import { createFsEmitter } from "../server/watch_fs.ts";

export default async function dev() {
  Deno.env.set("ALEPH_ENV", "development");

  const serverEntry = await findFile(builtinModuleExts.map((ext) => `server.${ext}`));
  if (!serverEntry) {
    log.error(`Could not find server entry file.`);
    Deno.exit(1);
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

  const emitter = createFsEmitter();
  emitter.on(`modify:./${basename(serverEntry)}`, start);
  // todo: watch server deps

  await start();
}

async function bootstrap(signal: AbortSignal, entry: string, fixedPort?: number) {
  // clean globally cached objects
  Reflect.deleteProperty(globalThis, "__ALEPH_SERVER");
  Reflect.deleteProperty(globalThis, "__ALEPH_INDEX_HTML");
  Reflect.deleteProperty(globalThis, "__UNO_GENERATOR");

  await import(`file://${entry}#${Date.now().toString(16)}`);
  if (Deno.env.get("ALEPH_SERVER_ENTRY") !== entry) {
    Deno.env.set("ALEPH_SERVER_ENTRY", entry);
    log.info(`Bootstrap server from ${blue(entry)}...`);
  }

  if (!Reflect.has(globalThis, "__ALEPH_SERVER")) {
    console.warn("No server found");
    Deno.exit(0);
  }

  const { port: userPort, hostname, certFile, keyFile, handler } = Reflect.get(globalThis, "__ALEPH_SERVER") || {};
  const port = fixedPort || userPort || 8080;
  try {
    if (certFile && keyFile) {
      await serveTls(handler, {
        port,
        hostname,
        certFile,
        keyFile,
        signal,
        onListen: ({ hostname, port }) => log.info(`Server ready on https://${hostname}:${port}`),
      });
    } else {
      await serve(handler, {
        port,
        hostname,
        signal,
        onListen: (port) => log.info(`Server ready on http://${hostname}:${port}`),
      });
    }
  } catch (error) {
    if (error instanceof Deno.errors.AddrInUse) {
      log.warn(`Port ${port} is in use, try ${port + 1}...`);
      await bootstrap(signal, entry, port + 1);
    } else {
      throw error;
    }
  }
}
