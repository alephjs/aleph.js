import { assertEquals } from "std/testing/asserts.ts";
import { cleanPath, isLikelyHttpURL, prettyBytes, splitBy, trimPrefix, trimSuffix } from "../shared/util.ts";

Deno.test("[unit] shared/util.ts", async (t) => {
  await t.step("isLikelyHttpURL", () => {
    assertEquals(isLikelyHttpURL("https://deno.land"), true);
    assertEquals(isLikelyHttpURL("http://deno.land"), true);
    assertEquals(isLikelyHttpURL("//deno.land"), false);
    assertEquals(isLikelyHttpURL("file:///deno.land"), false);
    assertEquals(isLikelyHttpURL("www.deno.land"), false);
  });

  await t.step("trimPrefix", () => {
    assertEquals(trimPrefix("foobar", "foo"), "bar");
    assertEquals(trimPrefix("foobar", "baz"), "foobar");
    assertEquals(trimSuffix("foobar", "bar"), "foo");
    assertEquals(trimSuffix("foobar", "baz"), "foobar");
  });

  await t.step("splitBy", () => {
    // test `splitBy`
    assertEquals(splitBy("/app.tsx", "."), ["/app", "tsx"]);
    assertEquals(splitBy("foo.bar.", "."), ["foo", "bar."]);
    assertEquals(splitBy("foobar.", "."), ["foobar", ""]);
    assertEquals(splitBy(".foobar.", "."), ["", "foobar."]);
    assertEquals(splitBy("foobar", "."), ["foobar", ""]);
  });

  await t.step("prettyBytes", () => {
    assertEquals(prettyBytes(1000), "1000B");
    assertEquals(prettyBytes(1024), "1KB");
    assertEquals(prettyBytes(2048), "2KB");
    assertEquals(prettyBytes(3000), "2.93KB");
    assertEquals(prettyBytes(1024 ** 2), "1MB");
    assertEquals(prettyBytes(1024 ** 3), "1GB");
    assertEquals(prettyBytes(1024 ** 4), "1TB");
    assertEquals(prettyBytes(1024 ** 5), "1PB");
  });

  await t.step("cleanPath", () => {
    assertEquals(cleanPath("./"), "/");
    assertEquals(cleanPath("./a/./b/./c/."), "/a/b/c");
    assertEquals(cleanPath("../"), "/");
    assertEquals(cleanPath("../a/b/c"), "/a/b/c");
    assertEquals(cleanPath("/a/../b/c"), "/b/c");
    assertEquals(cleanPath("/a/b/../c"), "/a/c");
    assertEquals(cleanPath("\\a\\b\\c"), "/a/b/c");
    assertEquals(cleanPath("\\a\\b\\.\\..\\c"), "/a/c");
    assertEquals(cleanPath("//a//b//c//"), "/a/b/c");
  });
});
