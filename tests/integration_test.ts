import { assertEquals } from "std/testing/asserts.ts";
import * as usersAPI from "../examples/api-app/routes/users/index.ts";
import { mockAPIRequest, mockFormData } from "./mock.ts";

Deno.test("[integration] examples/api-app", async (t) => {
  await t.step("API GET /users", async () => {
    const res = await mockAPIRequest(usersAPI, "GET", "/users");
    assertEquals(res.status, 200);
    assertEquals((await res.json()).length, usersAPI.users.length);
  });

  await t.step("API POST /users", async () => {
    const res = await mockAPIRequest(usersAPI, "POST", "/users", { body: mockFormData({ "name": "saul" }) });
    const ret = await res.json();
    assertEquals(res.status, 200);
    assertEquals(ret.uid, 5);
    assertEquals(ret.name, "saul");

    const res2 = await mockAPIRequest(usersAPI, "GET", "/users");
    const ret2 = await res2.json();
    assertEquals(res2.status, 200);
    assertEquals(ret2.length, usersAPI.users.length);
    assertEquals(ret2.at(-1).uid, 5);
    assertEquals(ret2.at(-1).name, "saul");
  });
});
