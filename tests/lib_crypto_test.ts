import { assertEquals } from "std/testing/asserts.ts";
import { computeHash } from "../lib/crypto.ts";

Deno.test("shared/crypto: computeHash", async () => {
  assertEquals(
    await computeHash("sha-1", "hello world!"),
    "430ce34d020724ed75a196dfc2ad67c77772d169",
  );
  assertEquals(
    await computeHash("sha-1", new Uint8Array([21, 31])),
    "b0d04c3ac51b86296251d73c20f348e9ae0042a4",
  );
});
