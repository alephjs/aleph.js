let isBuilding = false;

export default async function build() {
  if (isBuilding) {
    return;
  }
  isBuilding = true;
  const p = Deno.run({
    cmd: ["wasm-pack", "build", "--target", "web"],
    stdout: "inherit",
    stderr: "inherit",
  });
  await p.status();
  p.close();
  isBuilding = false;
}
