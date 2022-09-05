import { defineComponent, inject, isVNode, onBeforeUnmount, VNode } from "vue";
import { ssrRenderComponent } from "@vue/server-renderer";
import util from "../../shared/util.ts";

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

    if (this.$slots.default) {
      const { document } = window;
      const insertedEls: Array<HTMLElement> = [];
      const children = parseSlots(this.$slots.default());
      children.forEach((vnode) => {
        const { type, props, children } = vnode;
        const el = document.createElement(type);
        if (children) el.innerText = children;
        if (props) {
          Object.keys(props).forEach((key) => {
            const value = props[key];
            el.setAttribute(key, String(value || ""));
          });
        }
        document.head.appendChild(el);
        insertedEls.push(el);
      });
      onBeforeUnmount(() => {
        insertedEls.forEach((el) => document.head.removeChild(el));
      });
    }
  },
  render() {
    return [];
  },
});

type ParseSlots = {
  type: string;
  props?: Record<string, unknown> | null;
  children?: string | null;
};

function parseSlots(vnodes: VNode[]): ParseSlots[] {
  const els: ParseSlots[] = [];
  const walk = (vnode: VNode) => {
    if (!isVNode(vnode)) {
      return;
    }

    const { type, props, children } = vnode;

    switch (type) {
      // ingore `script` and `no-script` tag
      // ingore `style` tag
      case "base":
      case "meta":
      case "link":
        // remove the children of base/meta/link elements
        els.push({ type, props });
        break;
      case "title":
        if (util.isFilledString(children)) {
          els.push({ type, props, children });
        } else if (util.isFilledArray(children)) {
          els.push({ type, props, children: children.join("") });
        } else {
          els.push({ type, props });
        }
        break;
    }
  };

  vnodes.forEach((vnode) => walk(vnode));

  return els;
}
