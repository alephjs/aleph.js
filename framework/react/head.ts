import type { FC, ReactNode } from "https://esm.sh/react@17.0.2";
import {
  Children,
  createElement,
  Fragment,
  isValidElement,
  useContext,
  useEffect,
  useMemo,
} from "https://esm.sh/react@17.0.2";
import util from "../../lib/util.ts";
import MainContext from "./context.ts";

export const Head: FC = (props) => {
  const { ssrHeadCollection } = useContext(MainContext);
  const [els, forwardNodes] = useMemo(() => parse(props.children), [
    props.children,
  ]);

  if (ssrHeadCollection) {
    els.forEach(({ type, props }) => {
      const { children, ...rest } = props;
      if (type === "title") {
        if (util.isFilledString(children)) {
          ssrHeadCollection.push(`<title ssr>${children}</title>`);
        } else if (util.isFilledArray(children)) {
          ssrHeadCollection.push(`<title ssr>${children.join("")}</title>`);
        }
      } else {
        const attrs = Object.entries(rest).map(([key, value]) => ` ${key}=${JSON.stringify(value)}`)
          .join("");
        if (util.isFilledString(children)) {
          ssrHeadCollection.push(`<${type}${attrs} ssr>${children}</${type}>`);
        } else if (util.isFilledArray(children)) {
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
    const insertedEls: Array<HTMLElement> = [];

    if (els.length > 0) {
      els.forEach(({ type, props }) => {
        const el = document.createElement(type);
        Object.keys(props).forEach((key) => {
          const value = props[key];
          if (key === "children") {
            if (util.isFilledString(value)) {
              el.innerText = value;
            } else if (util.isFilledArray(value)) {
              el.innerText = value.join("");
            }
          } else {
            el.setAttribute(key, String(value || ""));
          }
        });
        document.head.appendChild(el);
        insertedEls.push(el);
      });
    }

    return () => {
      insertedEls.forEach((el) => document.head.removeChild(el));
    };
  }, [els]);

  return createElement(Fragment, null, ...forwardNodes);
};

function parse(
  node: ReactNode,
): [{ type: string; props: Record<string, unknown> }[], ReactNode[]] {
  const els: { type: string; props: Record<string, unknown> }[] = [];
  const forwardNodes: ReactNode[] = [];
  const parseFn = (node: ReactNode) => {
    Children.forEach(node, (child) => {
      if (!isValidElement(child)) {
        return;
      }

      const { type, props } = child;
      switch (type) {
        case Fragment:
          parseFn(props.children);
          break;

        // case InlineStyle:
        //   forwardNodes.push(createElement(InlineStyle, props));
        //   break;

        // ingore `script` and `no-script` tag

        case "base":
        case "title":
        case "meta":
        case "link":
        case "style":
          // remove the children prop of base/meta/link
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

  parseFn(node);
  return [els, forwardNodes];
}
