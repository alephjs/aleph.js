import { assertEquals } from "std/testing/asserts.ts";
import { getContentType } from "../lib/media_type.ts";

Deno.test("[unit] lib/mime.ts: getContentType", () => {
  assertEquals(getContentType("/mod.ts"), "application/typescript");
  assertEquals(getContentType("/mod.tsx"), "text/tsx");
  assertEquals(getContentType("/compression.gz"), "application/gzip");
  assertEquals(getContentType("/compression.tar"), "application/tar");
  assertEquals(getContentType("/compression.tar.gz"), "application/tar+gzip");
  assertEquals(getContentType("/unknown"), "application/octet-stream");
});
