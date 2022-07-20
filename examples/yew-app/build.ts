import { fromFileUrl } from "https://deno.land/std@0.145.0/path/mod.ts";

let isBuilding = false;

export async function build() {
  if (isBuilding) return;
  isBuilding = true;

  const cwd = fromFileUrl(new URL(".", import.meta.url));
  const p = Deno.run({
    cmd: ["wasm-pack", "build", "--target", "web"],
    stdout: "inherit",
    stderr: "inherit",
    cwd,
  });
  await p.status();
  await Deno.remove(`${cwd}/pkg/.gitignore`);

  isBuilding = false;
}
