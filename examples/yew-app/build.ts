async function existsFile(path: string): Promise<boolean> {
  try {
    const stat = await Deno.lstat(path);
    return stat.isFile;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return false;
    }
    throw err;
  }
}

export default async function build(forceBuild?: boolean) {
  if (forceBuild || !(await existsFile("./pkg/package.json"))) {
    const p = Deno.run({
      cmd: ["wasm-pack", "build", "--target", "web"],
      stdout: "inherit",
      stderr: "inherit",
    });
    await p.status();
    p.close();
  }
}
