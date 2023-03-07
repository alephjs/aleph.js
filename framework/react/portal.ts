import type { ReactNode, ReactPortal } from "react";
import { useCallback, useContext, useEffect, useState } from "react";
import { RouterContext } from "./context.ts";

/**
 *  The `usePortal` hook to create a portal node.
 *  Please ensure to pass the `React.createPortal` in `Router` props.
 *
 *  ```jsx
 *  function Modal() {
 *    const portal = usePortal({ type: "dialog", preventScroll: true });
 *    return portal(<p>Hello portal!</p>);
 *  }
 *  ```
 */
export function usePortal(
  props?: { key?: string | null; className?: string; lockScroll?: boolean; type?: "div" | "dialog" },
): (children: ReactNode) => ReactPortal | null {
  const { className, lockScroll, type, key } = props || {};
  const { createPortal } = useContext(RouterContext);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const { body } = document;
    const portalRoot = document.createElement(type ?? "div");
    if (key) {
      portalRoot.id = key;
    }
    if (className) {
      portalRoot.className = className;
    }
    if (lockScroll) {
      body.style.overflow = "hidden";
    }
    body.appendChild(portalRoot);

    if (type) {
      Object.assign(portalRoot.style, {
        width: "100vw",
        height: "100vh",
        backgroundColor: "transparent",
      });
      /* @ts-ignore */
      portalRoot.showModal?.();
    }

    setPortalRoot(portalRoot);

    return () => {
      body.removeChild(portalRoot);
      if (lockScroll) {
        body.style.overflow = "";
      }
      setPortalRoot(null);
    };
  }, [key, className, lockScroll, type]);

  return useCallback(
    (chlidren: ReactNode) => {
      if (!portalRoot) {
        return null;
      }
      if (!createPortal) {
        throw new Error("Please ensure to pass the `React.createPortal` in `Router` props");
      }
      return createPortal(chlidren, portalRoot, key);
    },
    [portalRoot, createPortal, key],
  );
}
