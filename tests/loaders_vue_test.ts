import { join } from "std/path/mod.ts";
import { assert, assertEquals } from "std/testing/asserts.ts";
import VueLoader from "../loaders/vue.ts";

Deno.test("[unit] loaders/vue.ts", async (t) => {
  await t.step("VueLoader", async () => {
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
    const { lang, code, inlineCSS, isTemplateLanguage } = await loader.load("/test.vue", { isDev: false });
    assertEquals(lang, "js");
    assert(code.includes(`createElementBlock as _createElementBlock } from "https://esm.sh/vue"`));
    assert(code.includes(`setup(__props)`));
    assert(code.includes(`const msg = ref("Hello World!")`));
    assert(code.includes(`_createElementBlock(_Fragment`));
    assert(code.includes(`_createElementVNode("h1"`));
    assert(code.includes(`_withDirectives(_createElementVNode("input"`));
    assert(code.includes(`__sfc__.__file = "./test.vue"`));
    assert(code.includes(`__sfc__.__scopeId = "data-v-`));
    assert(inlineCSS?.includes("h1[data-v-"));
    assert(inlineCSS?.includes("font-size: 30px;"));
    assert(isTemplateLanguage);
  });

  await t.step("VueLoader(ts)", async () => {
    const dir = await Deno.makeTempDir();
    Deno.chdir(dir);
    await Deno.writeTextFile(
      join(dir, "test.vue"),
      `
      <script setup lang="ts">
      let x: string | number = 1
      </script>

      <template>
        <p>{{ (x as number).toFixed(2) }}</p>
      </template>
    `,
    );
    const loader = new VueLoader();
    const { lang, code, isTemplateLanguage } = await loader.load("/test.vue", { isDev: false });
    assertEquals(lang, "ts");
    assert(code.includes(`createElementBlock as _createElementBlock } from "https://esm.sh/vue"`));
    assert(code.includes(`setup(__props)`));
    assert(code.includes(`let x: string | number = 1`));
    assert(code.includes(`_createElementBlock("p"`));
    assert(code.includes(`__sfc__.__file = "./test.vue"`));
    assert(isTemplateLanguage);
  });

  await t.step("VueLoader(hmr)", async () => {
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
    assert(code.includes(`createElementBlock as _createElementBlock } from "https://esm.sh/vue"`));
    assert(code.includes(`__sfc__.__hmrId = "`));
    assert(code.includes(`__sfc__.__scriptHash = "`));
    assert(code.includes(`__sfc__.render = function render(`));
  });

  await t.step("VueLoader(ssr)", async () => {
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
    assert(code.includes(`ssrInterpolate as _ssrInterpolate } from "https://esm.sh/@vue/server-renderer"`));
    assert(code.includes(`__ssrInlineRender: true,`));
    assert(code.includes(`setup(__props)`));
    assert(code.includes(`const msg = ref("Hello World!")`));
    assert(code.includes(`<h1`));
    assert(code.includes(`<input`));
    assert(code.includes(` data-v-`));
    assert(code.includes(`__file = "./test.vue"`));
    assert(code.includes(`__scopeId = "data-v-`));
    assert(inlineCSS?.includes("h1[data-v-"));
    assert(inlineCSS?.includes("font-size: 30px;"));
  });
});
