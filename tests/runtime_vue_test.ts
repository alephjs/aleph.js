import { assert, assertEquals, assertStringIncludes } from "std/testing/asserts.ts";
import VueSFCLoader from "../runtime/vue/sfc-loader.ts";

Deno.test("[unit] loaders/vue.ts", async (t) => {
  await t.step("VueSFCLoader", async () => {
    const testVue = `
    <script setup>
      import { ref } from "https://esm.sh/v108/vue@3"

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
  `;
    const loader = new VueSFCLoader();
    const { lang, code, inlineCSS } = await loader.load("./test.vue", testVue, { isDev: false });
    assert(loader.test("test.vue"));
    assertEquals(lang, "js");
    assertStringIncludes(code, `createElementBlock as _createElementBlock } from "https://esm.sh/v108/vue"`);
    assertStringIncludes(code, `setup(__props)`);
    assertStringIncludes(code, `const msg = ref("Hello World!")`);
    assertStringIncludes(code, `_createElementBlock(_Fragment`);
    assertStringIncludes(code, `_createElementVNode("h1"`);
    assertStringIncludes(code, `_withDirectives(_createElementVNode("input"`);
    assertStringIncludes(code, `__sfc__.__file = "./test.vue"`);
    assertStringIncludes(code, `__sfc__.__scopeId = "data-v-`);
    assert(inlineCSS?.includes("h1[data-v-"));
    assert(inlineCSS?.includes("font-size: 30px;"));
  });

  await t.step("VueSFCLoader(ts)", async () => {
    const testVue = `
    <script setup lang="ts">
    let x: string | number = 1
    </script>

    <template>
      <p>{{ (x as number).toFixed(2) }}</p>
    </template>
  `;
    const loader = new VueSFCLoader();
    const { lang, code } = await loader.load("./test.vue", testVue, { isDev: false });
    assertEquals(lang, "ts");
    assertStringIncludes(code, `createElementBlock as _createElementBlock } from "https://esm.sh/v108/vue"`);
    assertStringIncludes(code, `setup(__props)`);
    assertStringIncludes(code, `let x: string | number = 1`);
    assertStringIncludes(code, `_createElementBlock("p"`);
    assertStringIncludes(code, `__sfc__.__file = "./test.vue"`);
  });

  await t.step("VueSFCLoader(hmr)", async () => {
    const testVue = `
      <script setup>
        import { ref } from "https://esm.sh/v108/vue@3"

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
    `;
    const loader = new VueSFCLoader();
    const { code } = await loader.load("./test.vue", testVue, { isDev: true });
    assertStringIncludes(code, `createElementBlock as _createElementBlock } from "https://esm.sh/v108/vue"`);
    assertStringIncludes(code, `__sfc__.__hmrId = "`);
    assertStringIncludes(code, `__sfc__.__scriptHash = "`);
    assertStringIncludes(code, `__sfc__.render = function render(`);
  });

  await t.step("VueSFCLoader(ssr)", async () => {
    const testVue = `
      <script setup>
        import { ref } from "https://esm.sh/v108/vue@3"

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
    `;
    const loader = new VueSFCLoader();
    const { code, inlineCSS } = await loader.load("./test.vue", testVue, { ssr: true });
    assertStringIncludes(code, `ssrInterpolate as _ssrInterpolate } from "https://esm.sh/v108/@vue/server-renderer"`);
    assertStringIncludes(code, `__ssrInlineRender: true,`);
    assertStringIncludes(code, `setup(__props)`);
    assertStringIncludes(code, `const msg = ref("Hello World!")`);
    assertStringIncludes(code, `<h1`);
    assertStringIncludes(code, `<input`);
    assertStringIncludes(code, ` data-v-`);
    assertStringIncludes(code, `__file = "./test.vue"`);
    assertStringIncludes(code, `__scopeId = "data-v-`);
    assert(inlineCSS?.includes("h1[data-v-"));
    assert(inlineCSS?.includes("font-size: 30px;"));
  });
});
