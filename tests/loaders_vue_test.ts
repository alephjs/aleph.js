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
  const { lang, code, inlineCSS, atomicCSS } = await loader.load("/test.vue", { isDev: false });
  assertEquals(loader.test("/app.vue"), true);
  assertEquals(loader.test("/app.jsx"), false);
  assertEquals(lang, "js");
  assertEquals(code.includes(`createElementBlock as _createElementBlock } from "https://esm.sh/vue"`), true);
  assertEquals(code.includes(`setup(__props)`), true);
  assertEquals(code.includes(`const msg = ref("Hello World!")`), true);
  assertEquals(code.includes(`_createElementBlock(_Fragment`), true);
  assertEquals(code.includes(`_createElementVNode("h1"`), true);
  assertEquals(code.includes(`_withDirectives(_createElementVNode("input"`), true);
  assertEquals(code.includes(`__sfc__.__file = "./test.vue"`), true);
  assertEquals(code.includes(`__sfc__.__scopeId = "data-v-`), true);
  assertEquals(inlineCSS?.includes("h1[data-v-"), true);
  assertEquals(inlineCSS?.includes("font-size: 30px;"), true);
  assertEquals(atomicCSS, true);
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
  const { code } = await loader.load("/test.vue", { isDev: true });
  assertEquals(code.includes(`createElementBlock as _createElementBlock } from "https://esm.sh/vue"`), true);
  assertEquals(code.includes(`__sfc__.__hmrId = "`), true);
  assertEquals(code.includes(`__sfc__.__scriptHash = "`), true);
  assertEquals(code.includes(`__sfc__.render = function render(`), true);
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
  const { code, inlineCSS } = await loader.load("/test.vue", { ssr: true });
  assertEquals(code.includes(`ssrInterpolate as _ssrInterpolate } from "https://esm.sh/@vue/server-renderer"`), true);
  assertEquals(code.includes(`__ssrInlineRender: true,`), true);
  assertEquals(code.includes(`setup(__props)`), true);
  assertEquals(code.includes(`const msg = ref("Hello World!")`), true);
  assertEquals(code.includes(`<h1`), true);
  assertEquals(code.includes(`<input`), true);
  assertEquals(code.includes(` data-v-`), true);
  assertEquals(code.includes(`__file = "./test.vue"`), true);
  assertEquals(code.includes(`__scopeId = "data-v-`), true);
  assertEquals(inlineCSS?.includes("h1[data-v-"), true);
  assertEquals(inlineCSS?.includes("font-size: 30px;"), true);
});
