export default async function build() {
  const p = Deno.run({
    cmd: ["wasm-pack", "build", "--target", "web"],
    stdout: "inherit",
    stderr: "inherit",
  });
  await p.status();
  p.close();
}
