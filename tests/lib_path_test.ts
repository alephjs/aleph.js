import { assertEquals } from "std/testing/asserts.ts";
import { toLocalPath, toRelativePath } from "../lib/path.ts";

Deno.test("lib/path: toRelativePath", () => {
  assertEquals(toRelativePath("/baz/foobar", "/baz/aleph"), "../aleph");
  assertEquals(toRelativePath("baz/foobar", "baz/aleph"), "../aleph");
  assertEquals(toRelativePath("baz/foobar", "baz/foobar/aleph"), "./aleph");
});

Deno.test("lib/path: toLocalPath", () => {
  assertEquals(toLocalPath("https://foo.com/lib@0.1.0?action"), "/-/foo.com/lib@0.1.0?action");
  assertEquals(toLocalPath("https://deno.land/x/aleph@v0.3.0-alpha.29/"), "/-/deno.land/x/aleph@v0.3.0-alpha.29/");
  assertEquals(toLocalPath("http://foo.com/bar?lang=us-en"), "/-/http_foo.com/bar?lang=us-en");
  assertEquals(toLocalPath("http://foo.com:8080/bar"), "/-/http_foo.com_8080/bar");
  assertEquals(toLocalPath("file://foo/bar/"), "file://foo/bar/");
  assertEquals(toLocalPath("/foo/bar/"), "/foo/bar/");
});
