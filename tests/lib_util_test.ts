import { delay } from "std/async/delay.ts";
import { assertEquals } from "std/testing/asserts.ts";
import util from "../lib/util.ts";

Deno.test("lib/util.ts: isLikelyHttpURL", () => {
  assertEquals(util.isLikelyHttpURL("https://deno.land"), true);
  assertEquals(util.isLikelyHttpURL("http://deno.land"), true);
  assertEquals(util.isLikelyHttpURL("//deno.land"), false);
  assertEquals(util.isLikelyHttpURL("file:///deno.land"), false);
  assertEquals(util.isLikelyHttpURL("www.deno.land"), false);
});

Deno.test("lib/util.ts: trimPrefix", () => {
  assertEquals(util.trimPrefix("foobar", "foo"), "bar");
  assertEquals(util.trimPrefix("foobar", "baz"), "foobar");
  assertEquals(util.trimSuffix("foobar", "bar"), "foo");
  assertEquals(util.trimSuffix("foobar", "baz"), "foobar");
});

Deno.test("lib/util.ts: splitBy", () => {
  // test `splitBy`
  assertEquals(util.splitBy("/app.tsx", "."), ["/app", "tsx"]);
  assertEquals(util.splitBy("foo.bar.", "."), ["foo", "bar."]);
  assertEquals(util.splitBy("foobar.", "."), ["foobar", ""]);
  assertEquals(util.splitBy(".foobar.", "."), ["", "foobar."]);
  assertEquals(util.splitBy("foobar", "."), ["foobar", ""]);
});

Deno.test("lib/util.ts: prettyBytes", () => {
  assertEquals(util.prettyBytes(1000), "1000B");
  assertEquals(util.prettyBytes(1024), "1KB");
  assertEquals(util.prettyBytes(2048), "2KB");
  assertEquals(util.prettyBytes(3000), "2.93KB");
  assertEquals(util.prettyBytes(1024 ** 2), "1MB");
  assertEquals(util.prettyBytes(1024 ** 3), "1GB");
  assertEquals(util.prettyBytes(1024 ** 4), "1TB");
  assertEquals(util.prettyBytes(1024 ** 5), "1PB");
});

Deno.test("lib/util.ts: cleanPath", () => {
  assertEquals(util.cleanPath("./"), "/");
  assertEquals(util.cleanPath("./a/./b/./c/."), "/a/b/c");
  assertEquals(util.cleanPath("../"), "/");
  assertEquals(util.cleanPath("../a/b/c"), "/a/b/c");
  assertEquals(util.cleanPath("/a/../b/c"), "/b/c");
  assertEquals(util.cleanPath("/a/b/../c"), "/a/c");
  assertEquals(util.cleanPath("\\a\\b\\c"), "/a/b/c");
  assertEquals(util.cleanPath("\\a\\b\\.\\..\\c"), "/a/c");
  assertEquals(util.cleanPath("//a//b//c//"), "/a/b/c");
});

Deno.test("lib/util.ts: debounce", async () => {
  let n = 0;
  const plus = util.debounce(() => n++, 50);
  plus();
  assertEquals(n, 0);
  await delay(75);
  assertEquals(n, 1);
  plus();
  plus();
  plus();
  assertEquals(n, 1);
  await delay(75);
  assertEquals(n, 2);
});
