import { assert, assertEquals } from "std/testing/asserts.ts";
import { MockServer } from "aleph/server/mock.ts";
import { App } from "aleph/react";
import { renderToReadableStream } from "react-dom/server";

Deno.test("[integration] examples/react-app", async (t) => {
  const api = new MockServer({
    appDir: "./examples/react-app",
    router: {
      glob: "./routes/**/*.{tsx,ts}",
    },
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
    assert(html.includes(`The Fullstack Framework in Deno.</h1>`));
    assert(html.includes(` href="/todos" `));
    assert(html.includes(`>Todos App Demo</a>`));
    assert(html.includes(`<link rel="icon" href="/assets/logo.svg">`));
    assert(html.includes(`<script type="module" src="/main.tsx"></script>`));
    assert(html.includes(`<script id="routes-manifest" type="application/json">`));
    assert(html.includes(`<script id="ssr-modules" type="application/json">`));
  });

  await t.step("API PUT+PATCH /todos", async () => {
    const res = await api.fetch("/todos", { method: "PUT", body: JSON.stringify({ message: "better call saul!" }) });
    const data = await res.json();
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "application/json");
    assertEquals(data.todos.length, 1);
    assertEquals(data.todos.at(0).message, "better call saul!");
    assertEquals(data.todos.at(0).completed, false);

    const res2 = await api.fetch("/todos", {
      method: "PATCH",
      body: JSON.stringify({ id: data.todos.at(0).id, message: "Better Call Saul!", completed: true }),
    });
    const data2 = await res2.json();
    assertEquals(res2.status, 200);
    assertEquals(res2.headers.get("Content-Type"), "application/json");
    assertEquals(data2.todos.length, 1);
    assertEquals(data2.todos.at(0).message, "Better Call Saul!");
    assertEquals(data2.todos.at(0).completed, true);
  });

  await t.step("API GET /todos?_data_", async () => {
    const res = await api.fetch("/todos?_data_");
    const data = await res.json();
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "application/json");
    assertEquals(data.todos.length, 1);
  });

  await t.step("API GET /todos", async () => {
    const res = await api.fetch("/todos");
    const html = await res.text();
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "text/html; charset=utf-8");
    assert(html.includes(`<title ssr>Todos</title>`));
    assert(html.includes(`<header style="`));
    assert(html.includes(`>1</em>`));
    assert(html.includes(`Better Call Saul!</label>`));
  });

  await t.step("API DELETE /todos", async () => {
    const res = await api.fetch("/todos?_data_");
    const data = await res.json();
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "application/json");
    assertEquals(data.todos.length, 1);

    const res2 = await api.fetch("/todos", {
      method: "DELETE",
      body: JSON.stringify({ id: data.todos.at(0).id }),
    });
    const data2 = await res2.json();
    assertEquals(res2.status, 200);
    assertEquals(res2.headers.get("Content-Type"), "application/json");
    assertEquals(data2, { todos: [] });
  });

  await t.step("API GET /404", async () => {
    const res = await api.fetch("/404");
    const html = await res.text();
    assertEquals(res.status, 404);
    assertEquals(res.headers.get("Content-Type"), "text/html; charset=utf-8");
    assert(html.includes(`>Ooooooops, nothing here!</h2>`));
  });
});
