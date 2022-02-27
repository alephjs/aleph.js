import { assertEquals } from "std/testing/asserts.ts";
import { dirname, join } from "std/path/mod.ts";
import { matchRoutes, restoreUrl, toLocalPath } from "../lib/helpers.ts";
import { initRoutes } from "../server/routing.ts";

Deno.test("lib/helpers.ts: matchRoutes", async () => {
  const tmpDir = await Deno.makeTempDir();
  const files = [
    "./routes/_app.tsx",
    "./routes/_404.tsx",
    "./routes/about.tsx",
    "./routes/index.tsx",
    "./routes/docs.tsx",
    "./routes/docs/index.mdx",
    "./routes/docs/get-started.mdx",
    "./routes/works.tsx",
    "./routes/works/$id.tsx",
    "./routes/p/$path+.tsx",
  ];
  await Promise.all(files.map((file) => Deno.mkdir(join(tmpDir, dirname(file)), { recursive: true })));
  await Promise.all(files.map((file) => Deno.writeTextFile(join(tmpDir, file), "")));
  const routes = await initRoutes("./routes/**/*.{tsx,mdx}", tmpDir);
  assertEquals(routes.length, files.length);

  let matches = matchRoutes(new URL("/", "http://localhost:3000"), routes);
  assertEquals(matches.map(([ret]) => ret.pathname.input), ["/_app", "/"]);
  assertEquals(matches.map(([_, meta]) => meta.filename), ["./routes/_app.tsx", "./routes/index.tsx"]);

  matches = matchRoutes(new URL("/about", "http://localhost:3000"), routes);
  assertEquals(matches.map(([ret]) => ret.pathname.input), ["/_app", "/about"]);
  assertEquals(matches.map(([_, meta]) => meta.filename), ["./routes/_app.tsx", "./routes/about.tsx"]);

  matches = matchRoutes(new URL("/foo", "http://localhost:3000"), routes);
  assertEquals(matches.map(([ret]) => ret.pathname.input), ["/_app", "/_404"]);
  assertEquals(matches.map(([_, meta]) => meta.filename), ["./routes/_app.tsx", "./routes/_404.tsx"]);

  matches = matchRoutes(new URL("/docs", "http://localhost:3000"), routes);
  assertEquals(matches.map(([ret]) => ret.pathname.input), ["/_app", "/docs", "/docs/index"]);
  assertEquals(matches.map(([_, meta]) => meta.filename), [
    "./routes/_app.tsx",
    "./routes/docs.tsx",
    "./routes/docs/index.mdx",
  ]);

  matches = matchRoutes(new URL("/docs/get-started", "http://localhost:3000"), routes);
  assertEquals(matches.map(([ret]) => ret.pathname.input), ["/_app", "/docs", "/docs/get-started"]);
  assertEquals(matches.map(([_, meta]) => meta.filename), [
    "./routes/_app.tsx",
    "./routes/docs.tsx",
    "./routes/docs/get-started.mdx",
  ]);

  matches = matchRoutes(new URL("/works", "http://localhost:3000"), routes);
  assertEquals(matches.map(([ret]) => ret.pathname.input), ["/_app", "/works", "/_404"]);
  assertEquals(matches.map(([_, meta]) => meta.filename), [
    "./routes/_app.tsx",
    "./routes/works.tsx",
    "./routes/_404.tsx",
  ]);

  matches = matchRoutes(new URL("/works/123", "http://localhost:3000"), routes);
  assertEquals(matches.map(([ret]) => ret.pathname.input), ["/_app", "/works", "/works/123"]);
  assertEquals(matches.map(([ret]) => ret.pathname.groups), [{}, {}, { id: "123" }]);
  assertEquals(matches.map(([_, meta]) => meta.filename), [
    "./routes/_app.tsx",
    "./routes/works.tsx",
    "./routes/works/$id.tsx",
  ]);

  matches = matchRoutes(new URL("/p/foo/bar/123", "http://localhost:3000"), routes);
  assertEquals(matches.map(([ret]) => ret.pathname.input), ["/_app", "/p/foo/bar/123"]);
  assertEquals(matches.map(([ret]) => ret.pathname.groups), [{}, { path: "foo/bar/123" }]);
  assertEquals(matches.map(([_, meta]) => meta.filename), [
    "./routes/_app.tsx",
    "./routes/p/$path+.tsx",
  ]);
});

Deno.test("lib/helpers.ts: toLocalPath", () => {
  assertEquals(toLocalPath("https://foo.com/lib@0.1.0?action"), "/-/foo.com/lib@0.1.0?action");
  assertEquals(toLocalPath("https://deno.land/x/aleph@0.1.0/"), "/-/deno.land/x/aleph@0.1.0");
  assertEquals(toLocalPath("http://foo.com/bar?lang=us-en"), "/-/http_foo.com/bar?lang=us-en");
  assertEquals(toLocalPath("http://foo.com:8080/bar"), "/-/http_foo.com_8080/bar");
  assertEquals(toLocalPath("file://foo/bar/"), "file://foo/bar/");
  assertEquals(toLocalPath("/foo/bar/"), "/foo/bar/");
});

Deno.test("lib/helpers.ts: restoreUrl", () => {
  assertEquals(restoreUrl("/-/foo.com/lib@0.1.0?action"), "https://foo.com/lib@0.1.0?action");
  assertEquals(restoreUrl("/-/deno.land/x/aleph@0.1.0"), "https://deno.land/x/aleph@0.1.0");
  assertEquals(restoreUrl("/-/http_foo.com/bar?lang=us-en"), "http://foo.com/bar?lang=us-en");
  assertEquals(restoreUrl("/-/http_foo.com_8080/bar"), "http://foo.com:8080/bar");
});
