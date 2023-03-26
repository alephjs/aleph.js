import { assertEquals, assertStringIncludes } from "std/testing/asserts.ts";
import { MockServer } from "aleph/server/mock.ts";
import { render } from "aleph/framework/react/plugin.ts";

Deno.test("[integration] examples/react-app", async (t) => {
  const api = new MockServer({
    appDir: "./examples/react-app",
    router: {
      glob: "./routes/**/*.{tsx,ts}",
    },
    ssr: { render },
  });

  await t.step("GET /", async () => {
    const res = await api.fetch("/");
    const html = await res.text();
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "text/html; charset=utf-8");
    assertStringIncludes(html, `<header`);
    assertStringIncludes(html, `<title ssr>Aleph.js</title>`);
    assertStringIncludes(html, `<meta name="description" content="The Fullstack Framework in Deno." ssr>`);
    assertStringIncludes(html, `The Fullstack Framework in Deno.</h1>`);
    assertStringIncludes(html, ` href="/todos" `);
    assertStringIncludes(html, `>Todos App Demo</a>`);
    assertStringIncludes(html, `<link rel="icon" href="/assets/logo.svg`);
    assertStringIncludes(html, `<script type="module" src="/main.ts`);
    assertStringIncludes(html, `<script id="router-manifest" type="application/json">`);
    assertStringIncludes(html, `<script id="ssr-data" type="application/json">`);
  });

  await t.step("PUT+PATCH /todos", async () => {
    const res = await api.fetch("/todos", { method: "PUT", body: JSON.stringify({ message: "Better Call Saul!" }) });
    const data = await res.json();
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "application/json");
    assertEquals(data.todos.length, 1);
    assertEquals(data.todos.at(0).message, "Better Call Saul!");
    assertEquals(data.todos.at(0).completed, false);

    const res2 = await api.fetch("/todos", {
      method: "PATCH",
      body: JSON.stringify({ id: data.todos.at(0).id, completed: true }),
    });
    const data2 = await res2.json();
    assertEquals(res2.status, 200);
    assertEquals(res2.headers.get("Content-Type"), "application/json");
    assertEquals(data2.todos.length, 1);
    assertEquals(data2.todos.at(0).message, "Better Call Saul!");
    assertEquals(data2.todos.at(0).completed, true);
  });

  await t.step("GET /todos?_data_", async () => {
    const res = await api.fetch("/todos?_data_");
    const data = await res.json();
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "application/json");
    assertEquals(data.todos.length, 1);
  });

  await t.step("GET /todos", async () => {
    const res = await api.fetch("/todos");
    const html = await res.text();
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "text/html; charset=utf-8");
    assertStringIncludes(html, `<title ssr>Todos</title>`);
    assertStringIncludes(html, `<header`);
    assertStringIncludes(html, `>1</em>`);
    assertStringIncludes(html, `Better Call Saul!</label>`);
  });

  await t.step("DELETE /todos", async () => {
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

  await t.step("GET /404", async () => {
    const res = await api.fetch("/404");
    const html = await res.text();
    assertEquals(res.status, 404);
    assertEquals(res.headers.get("Content-Type"), "text/html; charset=utf-8");
    assertStringIncludes(html, `>Ooooooops, nothing here!</h2>`);
  });
});
