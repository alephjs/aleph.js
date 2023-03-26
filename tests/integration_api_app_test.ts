import { assertEquals } from "std/testing/asserts.ts";
import { mockFormData, MockServer } from "aleph/server/mock.ts";

Deno.test("[integration] examples/api-app", async (t) => {
  const api = new MockServer({
    appDir: "./examples/api-app",
    router: {
      glob: "./routes/**/*.ts",
    },
    origin: "https://api.example.com",
  });

  await t.step("GET /", async () => {
    const res = await api.fetch("/");
    assertEquals(res.status, 200);
    assertEquals((await res.json()).users_url, "https://api.example.com/users");
  });

  await t.step("GET /users", async () => {
    const res = await api.fetch("/users");
    assertEquals(res.status, 200);
    assertEquals((await res.json()).length, 4);
  });

  await t.step("POST /users", async () => {
    const res = await api.fetch("/users", { method: "POST", body: mockFormData({ "name": "saul" }) });
    const ret = await res.json();
    assertEquals(res.status, 200);
    assertEquals(ret.uid, 5);
    assertEquals(ret.name, "saul");

    const res2 = await api.fetch("/users");
    const ret2 = await res2.json();
    assertEquals(res2.status, 200);
    assertEquals(ret2.length, 5);
    assertEquals(ret2.at(-1).uid, 5);
    assertEquals(ret2.at(-1).name, "saul");
  });

  await t.step("PATCH /users/5", async () => {
    const res = await api.fetch("/users/5", { method: "PATCH", body: mockFormData({ "name": "saul goodman" }) });
    const ret = await res.json();
    assertEquals(res.status, 200);
    assertEquals(ret.uid, 5);
    assertEquals(ret.name, "saul goodman");
  });

  await t.step("GET /users/5", async () => {
    const res = await api.fetch("/users/5");
    const ret = await res.json();
    assertEquals(res.status, 200);
    assertEquals(ret.uid, 5);
    assertEquals(ret.name, "saul goodman");
  });

  await t.step("DELETE /users/5", async () => {
    const res = await api.fetch("/users/5", { method: "DELETE" });
    const ret = await res.json();
    assertEquals(res.status, 200);
    assertEquals(ret.uid, 5);
    assertEquals(ret.name, "saul goodman");
  });

  await t.step("GET /users/5", async () => {
    const res = await api.fetch("/users/5");
    assertEquals(res.status, 404);
  });
});
