import { assertEquals } from "std/testing/asserts.ts";
import { dirname, join } from "std/path/mod.ts";
import { matchRoutes } from "../lib/route.ts";
import { initRoutes } from "../server/routing.ts";

Deno.test("lib/helpers.ts: matchRoutes", async () => {
  const tmpDir = await Deno.makeTempDir();
  const files = [
    "./routes/_404.tsx",
    "./routes/_app.tsx",
    "./routes/_error.tsx",
    "./routes/blog.tsx",
    "./routes/docs.tsx",
    "./routes/docs/get-started.mdx",
    "./routes/docs/index.mdx",
    "./routes/index.tsx",
    "./routes/utils.ts",
    "./routes/works.tsx",
    "./routes/works/$id.tsx",
    "./routes/works/$id/$page+.tsx",
    "./routes/works/$id/index.tsx",
    "./routes/works/$id/order.tsx",
    "./routes/works/index.tsx",
    "./routes/works/new.tsx",
    "./routes/users/index.tsx",
    "./routes/users/$uid.tsx",
    "./routes/users/$uid/index.tsx",
    "./routes/users/$uid/settings/$page.tsx",
    "./routes/post/[date]/[...slug].tsx",
  ];
  await Promise.all(files.map((file) => Deno.mkdir(join(tmpDir, dirname(file)), { recursive: true })));
  await Promise.all(files.map((file) => Deno.writeTextFile(join(tmpDir, file), "")));
  const routes = await initRoutes("./routes/**/*.{tsx,mdx}", tmpDir);
  assertEquals(routes.routes.length, files.length - 1);
  assertEquals(routes.routes.filter(([_, meta]) => meta.nesting).length, 5);

  let matches = matchRoutes(new URL("/", "http://localhost:3000"), routes);
  assertEquals(matches.map(([ret]) => ret.pathname.input), ["/_app", "/"]);
  assertEquals(matches.map(([_, meta]) => meta.filename), ["./routes/_app.tsx", "./routes/index.tsx"]);

  matches = matchRoutes(new URL("/blog", "http://localhost:3000"), routes);
  assertEquals(matches.map(([ret]) => ret.pathname.input), ["/_app", "/blog"]);
  assertEquals(matches.map(([_, meta]) => meta.filename), ["./routes/_app.tsx", "./routes/blog.tsx"]);

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

  matches = matchRoutes(new URL("/post/2022-04-18/better-call-saul/wine-and-roses", "http://localhost:3000"), routes);
  assertEquals(matches.map(([ret]) => ret.pathname.input), [
    "/_app",
    "/post/2022-04-18/better-call-saul/wine-and-roses",
  ]);
  assertEquals(matches.map(([ret]) => ret.pathname.groups), [{}, {
    date: "2022-04-18",
    slug: "better-call-saul/wine-and-roses",
  }]);
  assertEquals(matches.map(([_, meta]) => meta.filename), [
    "./routes/_app.tsx",
    "./routes/post/[date]/[...slug].tsx",
  ]);

  matches = matchRoutes(new URL("/works", "http://localhost:3000"), routes);
  assertEquals(matches.map(([ret]) => ret.pathname.input), ["/_app", "/works", "/works/index"]);
  assertEquals(matches.map(([ret]) => ret.pathname.groups), [{}, {}, {}]);
  assertEquals(matches.map(([_, meta]) => meta.filename), [
    "./routes/_app.tsx",
    "./routes/works.tsx",
    "./routes/works/index.tsx",
  ]);

  matches = matchRoutes(new URL("/works/new", "http://localhost:3000"), routes);
  assertEquals(matches.map(([ret]) => ret.pathname.input), ["/_app", "/works", "/works/new"]);
  assertEquals(matches.map(([ret]) => ret.pathname.groups), [{}, {}, {}]);
  assertEquals(matches.map(([_, meta]) => meta.filename), [
    "./routes/_app.tsx",
    "./routes/works.tsx",
    "./routes/works/new.tsx",
  ]);

  matches = matchRoutes(new URL("/works/14", "http://localhost:3000"), routes);
  assertEquals(matches.map(([ret]) => ret.pathname.input), ["/_app", "/works", "/works/14", "/works/14/index"]);
  assertEquals(matches.map(([ret]) => ret.pathname.groups), [{}, {}, { id: "14" }, { id: "14" }]);
  assertEquals(matches.map(([_, meta]) => meta.filename), [
    "./routes/_app.tsx",
    "./routes/works.tsx",
    "./routes/works/$id.tsx",
    "./routes/works/$id/index.tsx",
  ]);

  matches = matchRoutes(new URL("/works/14/order", "http://localhost:3000"), routes);
  assertEquals(matches.map(([ret]) => ret.pathname.input), ["/_app", "/works", "/works/14", "/works/14/order"]);
  assertEquals(matches.map(([ret]) => ret.pathname.groups), [{}, {}, { id: "14" }, { id: "14" }]);
  assertEquals(matches.map(([_, meta]) => meta.filename), [
    "./routes/_app.tsx",
    "./routes/works.tsx",
    "./routes/works/$id.tsx",
    "./routes/works/$id/order.tsx",
  ]);

  matches = matchRoutes(new URL("/works/14/admin/edit", "http://localhost:3000"), routes);
  assertEquals(matches.map(([ret]) => ret.pathname.input), ["/_app", "/works", "/works/14", "/works/14/admin/edit"]);
  assertEquals(matches.map(([ret]) => ret.pathname.groups), [{}, {}, { id: "14" }, { id: "14", page: "admin/edit" }]);
  assertEquals(matches.map(([_, meta]) => meta.filename), [
    "./routes/_app.tsx",
    "./routes/works.tsx",
    "./routes/works/$id.tsx",
    "./routes/works/$id/$page+.tsx",
  ]);

  matches = matchRoutes(new URL("/users", "http://localhost:3000"), routes);
  assertEquals(matches.map(([ret]) => ret.pathname.input), ["/_app", "/users/index"]);
  assertEquals(matches.map(([ret]) => ret.pathname.groups), [{}, {}]);
  assertEquals(matches.map(([_, meta]) => meta.filename), [
    "./routes/_app.tsx",
    "./routes/users/index.tsx",
  ]);

  matches = matchRoutes(new URL("/users/ije", "http://localhost:3000"), routes);
  assertEquals(matches.map(([ret]) => ret.pathname.input), ["/_app", "/users/ije", "/users/ije/index"]);
  assertEquals(matches.map(([ret]) => ret.pathname.groups), [{}, { uid: "ije" }, { uid: "ije" }]);
  assertEquals(matches.map(([_, meta]) => meta.filename), [
    "./routes/_app.tsx",
    "./routes/users/$uid.tsx",
    "./routes/users/$uid/index.tsx",
  ]);

  matches = matchRoutes(new URL("/users/ije/settings/profile", "http://localhost:3000"), routes);
  assertEquals(matches.map(([ret]) => ret.pathname.input), ["/_app", "/users/ije", "/users/ije/settings/profile"]);
  assertEquals(matches.map(([ret]) => ret.pathname.groups), [{}, { uid: "ije" }, { uid: "ije", page: "profile" }]);
  assertEquals(matches.map(([_, meta]) => meta.filename), [
    "./routes/_app.tsx",
    "./routes/users/$uid.tsx",
    "./routes/users/$uid/settings/$page.tsx",
  ]);
});
