import dev, { createFsEmitter } from "aleph/server/dev.ts";

async function build() {
  if (Reflect.get(globalThis, "isBuilding")) return;
  Reflect.set(globalThis, "isBuilding", true);

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
  Reflect.set(globalThis, "isBuilding", false);
}

const emitter = createFsEmitter();
emitter.on("*", (_kind, { specifier }) => {
  if (
    (specifier.startsWith("./src/") && specifier.endsWith(".rs")) ||
    specifier === "./Cargo.toml"
  ) {
    build();
  }
});

await build();

dev({
  baseUrl: import.meta.url,
});
