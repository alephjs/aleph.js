import { assertEquals } from "std/testing/asserts.ts";
import { mockAPI, mockFormData } from "aleph/tests/mock.ts";

Deno.test("[integration] examples/api-app", async (t) => {
  const api = mockAPI({
    routes: "./examples/api-app/routes/**/*.ts",
  });

  await t.step("API GET /users", async () => {
    const res = await api.fetch("/users");
    assertEquals(res.status, 200);
    assertEquals((await res.json()).length, 4);
  });

  await t.step("API POST /users", async () => {
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

  await t.step("API PATCH /users/5", async () => {
    const res = await api.fetch("/users/5", { method: "PATCH", body: mockFormData({ "name": "saul goodman" }) });
    const ret = await res.json();
    assertEquals(res.status, 200);
    assertEquals(ret.uid, 5);
    assertEquals(ret.name, "saul goodman");
  });

  await t.step("API GET /users/5", async () => {
    const res = await api.fetch("/users/5");
    const ret = await res.json();
    assertEquals(res.status, 200);
    assertEquals(ret.uid, 5);
    assertEquals(ret.name, "saul goodman");
  });

  await t.step("API DELETE /users/5", async () => {
    const res = await api.fetch("/users/5", { method: "DELETE" });
    const ret = await res.json();
    assertEquals(res.status, 200);
    assertEquals(ret.uid, 5);
    assertEquals(ret.name, "saul goodman");
  });

  await t.step("API GET /users/5", async () => {
    const res = await api.fetch("/users/5");
    assertEquals(res.status, 404);
  });
});
