import type { FC, ReactNode } from "react";
import { Children, createElement, Fragment, isValidElement, useContext, useEffect, useMemo } from "react";
import { isFilledArray, isFilledString } from "../../shared/util.ts";
import { RouterContext } from "./context.ts";

export const Head: FC<{ children?: ReactNode }> = (props) => {
  const { ssrHeadCollection } = useContext(RouterContext);
  const [els, forwardNodes] = useMemo(() => parse(props.children), [
    props.children,
  ]);

  if (ssrHeadCollection) {
    els.forEach(({ type, props }) => {
      const { children, ...rest } = props;
      if (type === "title") {
        if (isFilledString(children)) {
          ssrHeadCollection.push(`<title ssr>${children}</title>`);
        } else if (isFilledArray(children)) {
          ssrHeadCollection.push(`<title ssr>${children.join("")}</title>`);
        }
      } else {
        const attrs = Object.entries(rest).map(([key, value]) => ` ${key}=${JSON.stringify(value)}`)
          .join("");
        if (isFilledString(children)) {
          ssrHeadCollection.push(`<${type}${attrs} ssr>${children}</${type}>`);
        } else if (isFilledArray(children)) {
          ssrHeadCollection.push(
            `<${type}${attrs} ssr>${children.join("")}</${type}>`,
          );
        } else {
          ssrHeadCollection.push(`<${type}${attrs} ssr>`);
        }
      }
    });
  }

  useEffect(() => {
    const { document } = window;
    const { head } = document;
    const insertedEls: Array<HTMLElement> = [];

    if (els.length > 0) {
      els.forEach(({ type, props }) => {
        const el = document.createElement(type);
        Object.keys(props).forEach((key) => {
          const value = props[key];
          if (key === "children") {
            if (isFilledString(value)) {
              el.innerText = value;
            } else if (isFilledArray(value)) {
              el.innerText = value.join("");
            }
          } else {
            el.setAttribute(key, String(value || ""));
          }
        });
        head.appendChild(el);
        insertedEls.push(el);
      });
    }

    // remove ssr head elements
    Array.from(head.children).forEach((el: Element) => {
      if (el.hasAttribute("ssr")) {
        head.removeChild(el);
      }
    });

    return () => {
      insertedEls.forEach((el) => head.removeChild(el));
    };
  }, [els]);

  return createElement(Fragment, null, ...forwardNodes);
};

function parse(
  node: ReactNode,
): [{ type: string; props: Record<string, unknown> }[], ReactNode[]] {
  const els: { type: string; props: Record<string, unknown> }[] = [];
  const forwardNodes: ReactNode[] = [];
  const walk = (node: ReactNode) => {
    Children.forEach(node, (child) => {
      if (!isValidElement(child)) {
        return;
      }

      const { type, props } = child;
      switch (type) {
        case Fragment:
          walk(props.children);
          break;

        // ingore `script` and `no-script` tag

        case "base":
        case "title":
        case "meta":
        case "link":
        case "style":
          // remove the children prop of base/meta/link elements
          if (["base", "meta", "link"].includes(type) && "children" in props) {
            const { children: _, ...rest } = props;
            els.push({ type, props: rest });
          } else {
            els.push({ type, props });
          }
          break;
      }
    });
  };

  walk(node);
  return [els, forwardNodes];
}
