import { join } from "std/path/mod.ts";
import { assertEquals } from "std/testing/asserts.ts";
import VueLoader from "../loaders/vue.ts";

Deno.test("loaders/vue.ts: VueLoader", async () => {
  const dir = await Deno.makeTempDir();
  Deno.chdir(dir);
  await Deno.writeTextFile(
    join(dir, "test.vue"),
    `
    <script setup>
      import { ref } from "https://esm.sh/vue@3"

      const msg = ref("Hello World!")
    </script>

    <template>
      <h1>{{ msg }}</h1>
      <input v-model="msg">
    </template>

    <style scoped>
      h1 {
        font-size: 30px;
      }
    </style>
  `,
  );
  const loader = new VueLoader();
  const ret = await loader.load(new Request("http://localhost/test.vue"), { isDev: false });
  const js = (new TextDecoder().decode(ret.content));
  assertEquals(loader.test(new Request("http://localhost/app.vue")), true);
  assertEquals(loader.test(new Request("http://localhost/app.jsx")), false);
  assertEquals(ret.contentType, "application/javascript; charset=utf-8");
  assertEquals(js.includes(`createElementBlock as _createElementBlock}from"/-/esm.sh/vue"`), true);
  assertEquals(js.includes(`setup(__props)`), true);
  assertEquals(js.includes(`const msg=ref("Hello World!")`), true);
  assertEquals(js.includes(`_createElementBlock(_Fragment`), true);
  assertEquals(js.includes(`_createElementVNode("h1"`), true);
  assertEquals(js.includes(`_withDirectives(_createElementVNode("input"`), true);
  assertEquals(js.includes(`__sfc__.__file="./test.vue"`), true);
  assertEquals(js.includes(`__sfc__.__scopeId="data-v-`), true);
  assertEquals(ret.deps?.length, 3);
  assertEquals(ret.deps?.at(2)!.includes("h1[data-v-"), true);
  assertEquals(ret.deps?.at(2)!.includes("font-size: 30px;"), true);
});

Deno.test("loaders/vue.ts: VueLoader.hmr", async () => {
  const dir = await Deno.makeTempDir();
  Deno.chdir(dir);
  await Deno.writeTextFile(
    join(dir, "test.vue"),
    `
    <script setup>
      import { ref } from "https://esm.sh/vue@3"

      const msg = ref("Hello World!")
    </script>

    <template>
      <h1>{{ msg }}</h1>
      <input v-model="msg">
    </template>

    <style scoped>
      h1 {
        font-size: 30px;
      }
    </style>
  `,
  );
  const loader = new VueLoader();
  const ret = await loader.load(new Request("http://localhost/test.vue"), { isDev: true });
  const js = (new TextDecoder().decode(ret.content));
  assertEquals(js.includes(`createElementBlock as _createElementBlock } from "/-/esm.sh/vue?dev"`), true);
  assertEquals(js.includes(`__sfc__.__hmrId = "`), true);
  assertEquals(js.includes(`__sfc__.__scriptHash = "`), true);
  assertEquals(js.includes(`__sfc__.render = function render(`), true);
});

Deno.test("loaders/vue.ts: VueLoader.ssr", async () => {
  const dir = await Deno.makeTempDir();
  Deno.chdir(dir);
  await Deno.writeTextFile(
    join(dir, "test.vue"),
    `
    <script setup>
      import { ref } from "https://esm.sh/vue@3"

      const msg = ref("Hello World!")
    </script>

    <template>
      <h1>{{ msg }}</h1>
      <input v-model="msg">
    </template>

    <style scoped>
      h1 {
        font-size: 30px;
      }
    </style>
  `,
  );
  const loader = new VueLoader();
  const ret = await loader.load(new Request("http://localhost/test.vue"), { ssr: true });
  const js = (new TextDecoder().decode(ret.content));
  assertEquals(ret.contentType, "application/javascript; charset=utf-8");
  assertEquals(js.includes(`ssrInterpolate as _ssrInterpolate } from "https://esm.sh/@vue/server-renderer"`), true);
  assertEquals(js.includes(`__ssrInlineRender: true,`), true);
  assertEquals(js.includes(`setup (__props)`), true);
  assertEquals(js.includes(`const msg = ref("Hello World!")`), true);
  assertEquals(js.includes(`<h1`), true);
  assertEquals(js.includes(`<input`), true);
  assertEquals(js.includes(` data-v-`), true);
  assertEquals(js.includes(`__file = "./test.vue"`), true);
  assertEquals(js.includes(`__scopeId = "data-v-`), true);
  assertEquals(ret.deps?.length, 3);
  assertEquals(ret.deps?.at(2)!.includes("h1[data-v-"), true);
  assertEquals(ret.deps?.at(2)!.includes("font-size: 30px;"), true);
});
