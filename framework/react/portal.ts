import type { ReactNode, ReactPortal } from "react";
import { useContext, useEffect, useState } from "react";
import { RouterContext } from "./context.ts";

/**
 *  The `usePortal` hook to create a portal helper.
 *  Please ensure to pass the `React.createPortal` in `Router` props.
 *
 *  ```jsx
 *  function Modal() {
 *    const portal = usePortal({ preventScroll: true });
 *    return portal(<p>Hello portal!</p>);
 *  }
 *  ```
 */
export function usePortal(
  props?: { key: string | null; className?: string; preventScroll?: boolean },
): (el: ReactNode) => ReactPortal | null {
  const { key, className, preventScroll } = props || {};
  const { createPortal } = useContext(RouterContext);
  const [portalRoot, setPortalRoot] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    const bs = document.body.style;
    const pof = bs.overflow;
    const pofX = bs.overflowX;
    const pofY = bs.overflowY;
    if (preventScroll) {
      bs.overflow = "hidden";
      bs.overflowX = "hidden";
      bs.overflowY = "hidden";
    }

    const portalRoot = document.createElement("div");
    if (key) {
      portalRoot.id = key;
    }
    portalRoot.className = className ?? "portal-root";
    document.body.appendChild(portalRoot);
    setPortalRoot(portalRoot);

    return () => {
      setPortalRoot(null);
      document.body.removeChild(portalRoot);
      if (preventScroll) {
        bs.overflow = pof;
        bs.overflowX = pofX;
        bs.overflowY = pofY;
      }
    };
  }, [key, className, preventScroll]);

  if (!portalRoot) {
    return () => null;
  }

  if (!createPortal) {
    throw new Error("Please ensure to pass the `React.createPortal` in `Router` props");
  }

  return (el: ReactNode) => createPortal(el, portalRoot, key);
}
