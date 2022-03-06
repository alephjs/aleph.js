import { basename, resolve } from "https://deno.land/std@0.125.0/path/mod.ts";
import { getFlag, parse } from "../lib/flags.ts";
import { existsDir, findFile } from "../lib/fs.ts";
import { builtinModuleExts } from "../lib/helpers.ts";
import log, { blue } from "../lib/log.ts";
import util from "../lib/util.ts";
import { loadImportMap } from "../server/config.ts";
import { build } from "../server/build.ts";
import { serve } from "../server/mod.ts";
import { serveAppModules } from "../server/transformer.ts";

export const helpMessage = `
Usage:
    aleph build <dir> [...options]

<dir> represents the directory of Aleph.js app,
if the <dir> is empty, the current directory will be used.

Options:
    -P, --platform  <platform>   Set deploy platform [possible values: deno, cf-worker, vercel]
    -L, --log-level <log-level>  Set log level [possible values: debug, info]
    -h, --help                   Prints help message
`;

const supportedPlatforms = [
  ["deno-deploy", "Deno Deploy"],
  ["cf-worker", "Cloudflare Worker"],
  ["vercel", "Vercel"],
];

if (import.meta.main) {
  const { args, options } = parse();

  let platform = getFlag(options, ["P", "platform"])?.toLowerCase();
  if (platform) {
    if (!supportedPlatforms.some(([id]) => id === platform)) {
      log.fatal(`Unsupported platform: ${platform}`);
    }
  } else {
    Deno.stdout.write(
      util.utf8TextEncoder.encode([
        "Deploy to:",
        "",
        ...supportedPlatforms.map(([_, name], index) => `  ${index + 1}. ${name}`),
        "",
        "",
      ].join("\n")),
    );
    while (true) {
      const p = prompt("Select a platform:");
      const n = parseInt(p || "");
      if (util.isInt(n) && n > 0 && n <= supportedPlatforms.length) {
        platform = supportedPlatforms[n - 1][0];
        break;
      }
    }
  }

  if (platform === "cf-worker" || platform === "vercel") {
    log.fatal(`Deploy to ${supportedPlatforms.find(([id]) => id === platform)![1]} is not supported yet`);
  }

  const start = performance.now();

  // check working dir
  const workingDir = resolve(String(args[0] || "."));
  if (!await existsDir(workingDir)) {
    log.fatal("No such directory:", workingDir);
  }
  Deno.chdir(workingDir);

  serveAppModules(6060, { importMap: await loadImportMap() });

  let serverEntry = await findFile(workingDir, builtinModuleExts.map((ext) => `server.${ext}`));
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

  log.info(`Building for ${supportedPlatforms.find(([id]) => id === platform)![1]}...`);
  const { clientModules } = await build(workingDir, platform as unknown as "deno-deploy", serverEntry);
  log.info(`${clientModules.size} client modules built`);

  log.info(`Done in ${(performance.now() - start)}ms`);
  Deno.exit(0);
}
