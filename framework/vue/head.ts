import { defineComponent, inject, onBeforeUnmount } from "vue";
import { ssrRenderComponent } from "vue/server-renderer";
import util from "../../lib/util.ts";

export const Head = defineComponent({
  name: "Head",
  setup(_props, ctx) {
    const ssrHeadCollection: string[] | undefined = inject("ssrHeadCollection");
    if (ctx.slots.default && ssrHeadCollection) {
      const children = ctx.slots.default();
      children.forEach((vnode) => {
        const { props } = vnode;
        // add srr attr
        vnode.props = { ...props, ssr: "" };
        const s = ssrRenderComponent({ render: () => vnode }) as string[];
        ssrHeadCollection.push(...s);
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
