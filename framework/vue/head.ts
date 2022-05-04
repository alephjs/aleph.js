import { defineComponent, onBeforeUnmount } from "vue";
import { DataContext } from "./context.ts";
import util from "../../lib/util.ts";

export const Head = defineComponent({
  name: "Head",
  props: {},
  setup(_props, ctx) {
    if (ctx.slots.default) {
      const ssrHeadCollection: string[] = [];
      const children = ctx?.slots.default();
      children.forEach((vnode) => {
        const { type, children } = vnode;
        if (type === "title") {
          if (util.isFilledString(children)) {
            ssrHeadCollection.push(`<title ssr>${children}</title>`);
          } else if (util.isFilledArray(children)) {
            ssrHeadCollection.push(`<title ssr>${children.join("")}</title>`);
          }
        }
        DataContext.value.ssrHeadCollection = ssrHeadCollection;
      });
    }
  },
  beforeMount() {
    // remove ssr head elements
    const { head } = window.document;
    Array.from(head.children).forEach((el: Element) => {
      if (el.hasAttribute("ssr")) {
        head.removeChild(el);
      }
    });
  },
  mounted() {
    const { document } = window;
    const insertedEls: Array<HTMLElement> = [];
    if (this.$slots.default) {
      const defaultSlots = this.$slots.default();
      defaultSlots.forEach((vnode) => {
        const { type, children } = vnode;
        if (type === "title") {
          const el = document.createElement(type);
          if (util.isFilledString(children)) {
            el.innerText = children;
          } else if (util.isFilledArray(children)) {
            el.innerText = children.join("");
          }
          document.head.appendChild(el);
          insertedEls.push(el);
        }
      });
    }
    onBeforeUnmount(() => {
      insertedEls.forEach((el) => document.head.removeChild(el));
    });
  },
  render() {
    return [];
  },
});
