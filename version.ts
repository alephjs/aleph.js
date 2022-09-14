/** `VERSION` managed by https://deno.land/x/publish */
export const VERSION = "1.0.0-beta.4";

/** The flag indicates that the version is canary version. */
export const isCanary = false;

/** `prepublish` will be invoked before publish */
export async function prepublish(version: string) {
  const readme = await Deno.readTextFile("./README.md");

  await Deno.writeTextFile(
    "./README.md",
    readme.replace(
      /\/\/deno\.land\/x\/aleph@[a-z\d\.\-]+\//,
      `//deno.land/x/aleph@${version}/`,
    ),
  );
}
