import { useRouter } from "./router.ts";
import { defineComponent, h } from "vue";

export const Link = defineComponent({
  name: "Link",
  props: {
    to: {
      type: String,
      default: "",
    },
  },
  setup() {
    const { url, params } = useRouter();
    return {
      url,
      params,
    };
  },
  render() {
    return h("a", { href: this.$props.to }, this.$slots.default ? this.$slots.default() : []);
  },
});
