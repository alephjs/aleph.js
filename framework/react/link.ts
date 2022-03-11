import type { AnchorHTMLAttributes, CSSProperties, MouseEvent, PropsWithChildren } from "https://esm.sh/react@17.0.2";
import { createElement, useCallback, useEffect, useMemo, useRef } from "https://esm.sh/react@17.0.2";
import util from "../../lib/util.ts";
import events from "../core/events.ts";
import { redirect } from "../core/redirect.ts";
import { useRouter } from "./router.ts";

const prefetched = new Set<string>();

export type LinkProps = PropsWithChildren<
  {
    to: string;
    replace?: boolean;
    prefetch?: boolean;
  } & Omit<AnchorHTMLAttributes<Record<never, never>>, "herf" | "hrefLang">
>;

/**
 * Link Component to link between pages.
 */
export function Link(props: LinkProps) {
  const {
    to,
    prefetch: propPrefetch,
    replace,
    className,
    style,
    onClick: propOnClick,
    onMouseEnter: propOnMouseEnter,
    onMouseLeave: propOnMouseLeave,
    ["aria-current"]: propAriaCurrent,
    children,
    ...rest
  } = props;
  const { url: { pathname, searchParams } } = useRouter();
  const href = useMemo(() => {
    if (!util.isFilledString(to)) {
      throw new Error("<Link>: prop `to` is required.");
    }
    if (util.isLikelyHttpURL(to)) {
      return to;
    }
    let [p, q] = util.splitBy(to, "?");
    if (p.startsWith("/")) {
      p = util.cleanPath(p);
    } else {
      p = util.cleanPath(pathname + "/" + p);
    }
    return [p, q].filter(Boolean).join("?");
  }, [pathname, to]);
  const isActivated = useMemo(() => {
    if (!util.isFilledString(to)) {
      return false;
    }

    const [p, q] = util.splitBy(to, "?");
    if (util.trimSuffix(p, "/") !== pathname) {
      return false;
    }

    const search = new URLSearchParams(q);
    search.sort();
    if (search.toString() !== searchParams.toString()) {
      return false;
    }

    return true;
  }, [pathname, searchParams, to]);
  const ariaCurrent = useMemo(() => {
    if (util.isFilledString(propAriaCurrent)) {
      return propAriaCurrent;
    }
    if (href.startsWith("/")) {
      return "page";
    }
    return undefined;
  }, [href, propAriaCurrent]);
  const timerRef = useRef<number | null>(null);
  const prefetch = useCallback(() => {
    if (!util.isLikelyHttpURL(href) && !isActivated && !prefetched.has(href)) {
      events.emit("prefetchpage", { href });
      prefetched.add(href);
    }
  }, [href, isActivated]);
  const onMouseEnter = useCallback((e: MouseEvent) => {
    if (typeof propOnMouseEnter === "function") {
      propOnMouseEnter(e);
    }
    if (e.defaultPrevented) {
      return;
    }
    if (!timerRef.current && !prefetched.has(href)) {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        prefetch();
      }, 300);
    }
  }, [prefetch, href, propOnMouseEnter]);
  const onMouseLeave = useCallback((e: MouseEvent) => {
    if (typeof propOnMouseLeave === "function") {
      propOnMouseLeave(e);
    }
    if (e.defaultPrevented) {
      return;
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, [propOnMouseLeave]);
  const onClick = useCallback((e: MouseEvent) => {
    if (typeof propOnClick === "function") {
      propOnClick(e);
    }
    if (e.defaultPrevented || isModifiedEvent(e)) {
      return;
    }
    e.preventDefault();
    if (!isActivated) {
      redirect(href, replace);
    }
  }, [isActivated, href, replace]);

  useEffect(() => {
    if (propPrefetch) {
      prefetch();
    }
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [propPrefetch, prefetch]);

  return createElement(
    "a",
    {
      ...rest,
      className,
      style,
      href,
      onClick,
      onMouseEnter,
      onMouseLeave,
      "aria-current": ariaCurrent,
    },
    children,
  );
}

/**
 * Link Component to link between pages.
 */
export function NavLink(props: LinkProps & { activeClassName?: string; activeStyle?: CSSProperties }) {
  const { to, className: propClassName, style: propStyle, activeStyle, activeClassName, ...rest } = props;
  const { url: { pathname, searchParams } } = useRouter();
  const isActivated = useMemo(() => {
    if (!util.isFilledString(to)) {
      return false;
    }

    const [p, q] = util.splitBy(to, "?");
    if (util.trimSuffix(p, "/") !== pathname) {
      return false;
    }

    const search = new URLSearchParams(q);
    search.sort();
    if (search.toString() !== searchParams.toString()) {
      return false;
    }

    return true;
  }, [pathname, searchParams, to]);
  const className = useMemo(() => {
    if (!isActivated || !activeClassName) {
      return propClassName;
    }
    return [propClassName, activeClassName].filter(util.isFilledString).map((n) => n.trim()).filter(Boolean).join(" ");
  }, [propClassName, activeClassName, isActivated]);
  const style = useMemo(() => {
    if (!isActivated || !activeStyle) {
      return propStyle;
    }
    return Object.assign({}, propStyle, activeStyle);
  }, [propStyle, activeStyle, isActivated]);
  const linkProps: LinkProps = { ...rest, to, className, style };
  if (isActivated) {
    Object.assign(linkProps, { "data-active": "true" });
  }
  return createElement(Link, linkProps);
}

function isModifiedEvent(event: MouseEvent): boolean {
  const { target } = event.currentTarget as HTMLAnchorElement;
  const nativeEvent = event.nativeEvent;
  return (
    (target && target !== "_self") ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey || // triggers resource download
    (nativeEvent && nativeEvent.which === 2)
  );
}
