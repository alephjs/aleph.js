import { assert, assertEquals } from "std/testing/asserts.ts";
import { MockServer } from "aleph/server/mock.ts";
import { App } from "aleph/react";
import { renderToReadableStream } from "react-dom/server";

Deno.test("[integration] examples/react-app", async (t) => {
  const api = new MockServer({
    cwd: "./examples/react-app",
    routes: "./routes/**/*.{tsx,ts}",
    ssr: {
      dataDefer: false,
      render: (ctx) => renderToReadableStream(<App ssrContext={ctx} />, ctx),
    },
  });

  await t.step("API GET /", async () => {
    const res = await api.fetch("/");
    const html = await res.text();
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "text/html; charset=utf-8");
    assert(html.includes(`<header style=`));
    assert(html.includes(`<title ssr>Aleph.js</title>`));
    assert(html.includes(`<meta name="description" content="The Fullstack Framework in Deno." ssr>`));
    assert(html.includes(`<h1>The Fullstack Framework in Deno.</h1>`));
    assert(html.includes(`<a role="button" href="/todos" aria-current="page">Todos App Demo</a>`));
    assert(html.includes(`<script type="module" src="/main.tsx"></script>`));
    assert(html.includes(`<script id="routes-manifest" type="application/json">`));
    assert(html.includes(`<script id="ssr-modules" type="application/json">`));
  });

  await t.step("API GET /todos", async () => {
    const res = await api.fetch("/todos");
    const html = await res.text();
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "text/html; charset=utf-8");
    assert(html.includes(`<title ssr>Todos</title>`));
    assert(html.includes(`<h1><span>Todos</span></h1>`));
    assert(html.includes(`<header style=`));
  });

  await t.step("API GET /todos?_data_", async () => {
    const res = await api.fetch("/todos?_data_");
    const data = await res.json();
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "application/json");
    assertEquals(data, { todos: [] });
  });

  await t.step("API GET /404", async () => {
    const res = await api.fetch("/404");
    const html = await res.text();
    assertEquals(res.status, 404);
    assertEquals(res.headers.get("Content-Type"), "text/html; charset=utf-8");
    assert(html.includes(`<h2>Ooooooops, nothing here!</h2>`));
  });
});
