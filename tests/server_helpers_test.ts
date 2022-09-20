import { assertEquals } from "std/testing/asserts.ts";
import { MagicString, restoreUrl, toLocalPath } from "../server/helpers.ts";
import { parseDeps } from "../server/deps.ts";

Deno.test("server/helper.ts", async (t) => {
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

  await t.step("MagicString", async () => {
    const code = `// Deno 🦕 App (应用)
      import React from "htts://esm.sh/react";
      import foo from "./foo.js";
      import { bar } from './bar.js';
      const baz = await import('./baz.js');
      const worker = new Worker('./worker.js', { type: 'module' });
    `;
    const overwritedCode = `// Deno 🦕 App (应用)
      import React from "htts://esm.sh/react?dev";
      import foo from "./foo.js?v=123";
      import { bar } from "./bar.js?v=123";
      const baz = await import("./baz.js?v=123");
      const worker = new Worker("./worker.js?v=123", { type: 'module' });
    `;
    const deps = await parseDeps("./app.js", code);
    const m = new MagicString(code);
    for (const dep of deps) {
      if (dep.loc) {
        let url = dep.specifier;
        if (url.startsWith("htts://esm.sh/")) {
          url += "?dev";
        } else {
          url += "?v=123";
        }
        m.overwrite(dep.loc.start - 1, dep.loc.end - 1, `"${url}"`);
      }
    }
    assertEquals(m.toString(), overwritedCode);
  });
});
