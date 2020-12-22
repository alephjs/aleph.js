import { colors } from "../std.ts";

export const helpMessage = `
Usage:
    aleph upgrade

Options:
    -v, --version <version>  The version to upgrade to
    -h, --help               Prints help message
`;

async function run(...cmd: string[]) {
  const p = Deno.run({
    cmd,
    stdout: "piped",
    stderr: "piped",
  });
  Deno.stdout.write(await p.output());
  Deno.stderr.write(await p.stderrOutput());
  p.close();
}

export default async function (version: string) {
  const { latest, versions } =
    await (await fetch("https://cdn.deno.land/aleph/meta/versions.json"))
      .json();
  if (version === "latest") {
    version = latest;
  } else if (!versions.includes(version)) {
    version = "v" + version;
    if (!versions.includes(version)) {
      console.log(`${colors.red("error")}: version(${version}) not found`);
      Deno.exit(1);
    }
  }
  await run(
    "deno",
    "install",
    "-A",
    "-f",
    "-n",
    "aleph",
    `https://deno.land/x/aleph@${version}/cli.ts`,
  );
  Deno.exit(0);
}
