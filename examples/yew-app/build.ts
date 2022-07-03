let isBuilding = false;

export async function build() {
  if (isBuilding) return;
  isBuilding = true;

  const cwd = new URL(".", import.meta.url).pathname;
  const p = Deno.run({
    cmd: ["wasm-pack", "build", "--target", "web"],
    stdout: "inherit",
    stderr: "inherit",
    cwd,
  });
  await p.status();
  p.close();
  await Deno.remove(`${cwd}/pkg/.gitignore`);

  isBuilding = false;
}
