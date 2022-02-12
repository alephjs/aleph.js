import { StyleHTMLAttributes, useContext, useEffect, useLayoutEffect } from "https://esm.sh/react@17.0.2";
import util from "../../../lib/util.ts";
import { applyCSS, removeCSS } from "../../core/style.ts";
import Context from "../context.ts";

const inDeno = typeof Deno !== "undefined" && typeof Deno.env === "object";
const useIsomorphicLayoutEffect = inDeno ? useEffect : useLayoutEffect;

export default function InlineStyle({ children, ...rest }: StyleHTMLAttributes<{}>) {
  const { inlineStyles } = useContext(Context);
  const { __styleId: id } = rest as any;
  const css = children?.toString();

  if (id && css) {
    if (inDeno) {
      inlineStyles.set("#" + id, css);
    } else {
      applyCSS("#" + id, { css });
    }
  }

  useIsomorphicLayoutEffect(() => () => id && removeCSS("#" + id), []);

  return null;
}
