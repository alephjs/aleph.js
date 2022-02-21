import { assertEquals } from "std/testing/asserts.ts";
import { restoreUrl, toLocalPath } from "../lib/path.ts";

Deno.test("lib/path.ts: toLocalPath", () => {
  assertEquals(toLocalPath("https://foo.com/lib@0.1.0?action"), "/-/foo.com/lib@0.1.0?action");
  assertEquals(toLocalPath("https://deno.land/x/aleph@0.1.0/"), "/-/deno.land/x/aleph@0.1.0/");
  assertEquals(toLocalPath("http://foo.com/bar?lang=us-en"), "/-/http_foo.com/bar?lang=us-en");
  assertEquals(toLocalPath("http://foo.com:8080/bar"), "/-/http_foo.com_8080/bar");
  assertEquals(toLocalPath("file://foo/bar/"), "file://foo/bar/");
  assertEquals(toLocalPath("/foo/bar/"), "/foo/bar/");
});

Deno.test("lib/path.ts: restoreUrl", () => {
  assertEquals(restoreUrl("/-/foo.com/lib@0.1.0?action"), "https://foo.com/lib@0.1.0?action");
  assertEquals(restoreUrl("/-/deno.land/x/aleph@0.1.0/"), "https://deno.land/x/aleph@0.1.0/");
  assertEquals(restoreUrl("/-/http_foo.com/bar?lang=us-en"), "http://foo.com/bar?lang=us-en");
  assertEquals(restoreUrl("/-/http_foo.com_8080/bar"), "http://foo.com:8080/bar");
});
