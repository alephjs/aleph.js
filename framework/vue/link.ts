import { computed, defineComponent, h } from "vue";
import { useRouter } from "./router.ts";
import { cleanPath, isFilledString, isLikelyHttpURL, splitBy } from "../../shared/util.ts";
import { prefetchModule, redirect } from "../core/redirect.ts";

export const Link = defineComponent({
  name: "Link",
  props: {
    to: {
      type: String,
      default: "",
    },
    replace: {
      type: Boolean,
      default: undefined,
    },
  },
  setup(props) {
    const router = useRouter();
    const to = props.to;
    const pathname = router.value.url.pathname;
    const href = computed(() => {
      if (!isFilledString(to)) {
        throw new Error("<Link>: prop `to` is required.");
      }
      if (isLikelyHttpURL(to)) {
        return to;
      }
      let [p, q] = splitBy(to, "?");
      if (p.startsWith("/")) {
        p = cleanPath(p);
      } else {
        p = cleanPath(pathname + "/" + p);
      }
      return [p, q].filter(Boolean).join("?");
    });

    const onClick = (e: PointerEvent) => {
      if (e.defaultPrevented || isModifiedEvent(e)) {
        return;
      }
      e.preventDefault();
      redirect(href.value, props?.replace);
    };

    const prefetch = () => {
      if (!isLikelyHttpURL(href.value)) {
        prefetchModule(new URL(href.value, location.href));
      }
    };

    let timer: number | undefined | null = undefined;

    const onMouseenter = (e: PointerEvent) => {
      if (e.defaultPrevented) {
        return;
      }
      if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          prefetch();
        }, 150);
      }
    };

    const onMouseleave = (e: PointerEvent) => {
      if (e.defaultPrevented) {
        return;
      }
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    return {
      href,
      onClick,
      onMouseenter,
      onMouseleave,
    };
  },
  render() {
    return h(
      "a",
      {
        href: this.href,
        onClick: (e: PointerEvent) => {
          this.onClick(e);
        },
        onMouseenter: (e: PointerEvent) => {
          this.onMouseenter(e);
        },
        onMouseleave: (e: PointerEvent) => {
          this.onMouseleave(e);
        },
      },
      this.$slots.default ? this.$slots.default() : [],
    );
  },
});

function isModifiedEvent(event: MouseEvent): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}
