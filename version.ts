/** `VERSION` managed by https://deno.land/x/publish */
export const VERSION = "1.0.0-alpha.26";

/** The flag indicates that the version is canary version. */
export const isCanary = false;

/** `prepublish` will be invoked before publish. */
export async function prepublish(): Promise<boolean> {
  if (!window.confirm("Build compiler wasm?")) {
    return true;
  }

  const p = Deno.run({
    cmd: ["deno", "run", "-A", "build.ts"],
    cwd: "./compiler",
    stdout: "inherit",
    stderr: "inherit",
  });
  const { success } = await p.status();
  p.close();
  return success;
}
