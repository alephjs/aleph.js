import { defineComponent, h } from "vue";

export const Err = defineComponent({
  name: "Err",
  props: {
    status: {
      type: String,
      default: "404",
    },
    message: {
      type: String,
      default: "page not found",
    },
  },
  render() {
    return h("div", {
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100vw",
        height: "100vh",
        fontSize: 16,
      },
    }, [
      h("strong", { style: { fontWeight: "500" } }, this.$props.status),
      h("small", { style: { color: "#999", padding: "0 6px" } }, "-"),
      this.$props.message,
    ]);
  },
});
