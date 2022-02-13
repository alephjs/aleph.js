import { assert, assertEquals, assertNotEquals } from "std/testing/asserts.ts";
import { SEP } from "std/path/separator.ts";
import { existsDir, existsFile } from "../lib/fs.ts";

Deno.test(`lib/fs.ts: existsDir`, async () => {
  // true test cases
  const dir = await Deno.makeTempDir();
  assert(await existsDir(dir));
  assert(await existsDir(await Deno.realPath(getStandardFolder())));
  // false test cases
  const file = await Deno.makeTempFile();
  assertEquals(await existsDir(file), false);
  assertEquals(await existsDir(`${dir}${SEP}foo${SEP}bar`), false);
});

Deno.test(`lib/fs.ts: existsFile`, async () => {
  // true test cases
  const file = await Deno.makeTempFile();
  assert(await existsFile(file));
  // false test cases
  const dir = await Deno.makeTempDir();
  assert(!await existsFile(`${dir}`));
  assert(!await existsFile(`${dir}${SEP}foo${SEP}bar`));
});

/**
 * Returns an operating system-specific
 * example folder.
 * @returns 'C:\Windows' for Windows or
 *  '/tmp' for unix-based operating systems
 */
const getStandardFolder = () => {
  return Deno.build.os === "windows" ? "C:\\Windows" : "/tmp";
};
