import { assert, assertEquals } from "std/testing/asserts.ts";
import SolidTransformer from "../runtime/solid/transformer.ts";

Deno.test("[unit] loaders/solid.ts", async (t) => {
  await t.step("SolidTransformer", async () => {
    const testCode = `
    import { render} from "https://esm.sh/v110/solid-js/web";
    import { createSignal } from "https://esm.sh/v110/solid-js";

    const foo = "foo";

    function Counter() {
      const [count, setCount] = createSignal(0);
      const increment = () => setCount(count() + 1);

      return (
        <button type="button" onClick={increment}>
          {count()}
        </button>
      );
    }

    render(() => <Counter />, document.getElementById("app")!);
  `;
    const transformer = new SolidTransformer();
    const { lang, code } = await transformer.load("test.tsx", testCode, {});
    assert(transformer.test("test.tsx"));
    assertEquals(lang, "js");
    assert(code.includes('_$template(`<button type="button"></button>`,'));
    assert(code.includes("_$createComponent(Counter, {})"));
  });
});
