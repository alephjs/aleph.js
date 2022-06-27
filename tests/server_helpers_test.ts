import { SEP } from "std/path/separator.ts";
import { assert, assertEquals } from "std/testing/asserts.ts";
import { existsDir, existsFile, restoreUrl, toLocalPath } from "../server/helpers.ts";

Deno.test("server/helper.ts", async (t) => {
  await t.step(`lib/fs.ts: existsDir`, async () => {
    // true test cases
    const dir = await Deno.makeTempDir();
    assert(await existsDir(dir));
    assert(await existsDir(await Deno.realPath(getStandardFolder())));
    // false test cases
    const file = await Deno.makeTempFile();
    assertEquals(await existsDir(file), false);
    assertEquals(await existsDir(`${dir}${SEP}foo${SEP}bar`), false);
  });

  await t.step(`lib/fs.ts: existsFile`, async () => {
    // true test cases
    const file = await Deno.makeTempFile();
    assert(await existsFile(file));
    // false test cases
    const dir = await Deno.makeTempDir();
    assert(!await existsFile(`${dir}`));
    assert(!await existsFile(`${dir}${SEP}foo${SEP}bar`));
  });

  await t.step("toLocalPath", () => {
    assertEquals(toLocalPath("https://foo.com/lib@0.1.0?action"), "/-/foo.com/lib@0.1.0?action");
    assertEquals(toLocalPath("https://deno.land/x/aleph@0.1.0/"), "/-/deno.land/x/aleph@0.1.0");
    assertEquals(toLocalPath("http://foo.com/bar?lang=us-en"), "/-/http_foo.com/bar?lang=us-en");
    assertEquals(toLocalPath("http://foo.com:8080/bar"), "/-/http_foo.com_8080/bar");
    assertEquals(toLocalPath("file://foo/bar/"), "file://foo/bar/");
    assertEquals(toLocalPath("/foo/bar/"), "/foo/bar/");
  });

  await t.step("restoreUrl", () => {
    assertEquals(restoreUrl("/-/foo.com/lib@0.1.0?action"), "https://foo.com/lib@0.1.0?action");
    assertEquals(restoreUrl("/-/deno.land/x/aleph@0.1.0"), "https://deno.land/x/aleph@0.1.0");
    assertEquals(restoreUrl("/-/http_foo.com/bar?lang=us-en"), "http://foo.com/bar?lang=us-en");
    assertEquals(restoreUrl("/-/http_foo.com_8080/bar"), "http://foo.com:8080/bar");
  });
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
