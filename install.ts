import { red } from "https://deno.land/std@0.134.0/fmt/colors.ts";
import { parse } from "https://deno.land/std@0.134.0/flags/mod.ts";
import { dirname, join } from "https://deno.land/std@0.134.0/path/mod.ts";
import { isCanary } from "./version.ts";

const pkgName = isCanary ? "aleph_canary" : "aleph";

export async function checkVersion(version: string): Promise<string> {
  console.log("Looking up latest version...");

  const versionMetaUrl = `https://cdn.deno.land/${pkgName}/meta/versions.json`;
  const { latest, versions } = await (await fetch(versionMetaUrl)).json();

  if (version === "latest") {
    version = latest;
  } else if (!versions.includes(version)) {
    if (!versions.includes(version)) {
      console.log(`${red("error")}: version(${version}) not found!`);
      Deno.exit(1);
    }
  }

  return version;
}

export async function install(version: string, forceUpgrade = false) {
  const denoExecPath = Deno.execPath();
  const cmdExists = await existsFile(join(dirname(denoExecPath), pkgName));
  const p = Deno.run({
    cmd: [
      denoExecPath,
      "install",
      "-A",
      "--unstable",
      "--no-check",
      "--location=http://localhost/",
      "-n",
      pkgName,
      "-f",
      `https://deno.land/x/${pkgName}@${version}/cli.ts`,
    ],
    stdout: "null",
    stderr: "inherit",
  });
  const status = await p.status();
  if (status.success) {
    if (cmdExists && !forceUpgrade) {
      console.log(`Aleph.js${isCanary ? "(canary)" : ""} is up to ${version}`);
    } else {
      console.log(`Aleph.js${isCanary ? "(canary)" : ""} was installed successfully`);
      console.log(`Run 'aleph -h' to get started`);
    }
  }
  Deno.exit(status.code);
}

/* check whether or not the given path exists as regular file. */
async function existsFile(path: string): Promise<boolean> {
  try {
    const fi = await Deno.lstat(path);
    return fi.isFile;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return false;
    }
    throw err;
  }
}

if (import.meta.main) {
  const { _: args, ...options } = parse(Deno.args);
  const version = await checkVersion(options.v || options.version || args[0] || "latest");
  await install(version, true);
}
