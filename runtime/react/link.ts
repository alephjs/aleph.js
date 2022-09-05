import type { AnchorHTMLAttributes, CSSProperties, MouseEvent, MutableRefObject, PropsWithChildren } from "react";
import { createElement, useCallback, useEffect, useMemo, useRef } from "react";
import util from "../../shared/util.ts";
import events from "../core/events.ts";
import { redirect } from "../core/redirect.ts";
import { useRouter } from "./router.ts";

const prefetched = new Set<string>();

export type LinkProps = PropsWithChildren<
  {
    to: string;
    replace?: boolean;
    prefetch?: boolean;
    innerRef?: MutableRefObject<HTMLAnchorElement | null>;
  } & Omit<AnchorHTMLAttributes<Record<never, never>>, "herf" | "hrefLang">
>;

/**
 * The `<Link>` component to link between pages.
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
    innerRef,
    ...rest
  } = props;
  const { url: { pathname } } = useRouter();
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
  const ariaCurrent = useMemo(() => {
    if (util.isFilledString(propAriaCurrent)) {
      return propAriaCurrent;
    }
    if (href.startsWith("/")) {
      return "page";
    }
    return undefined;
  }, [href, propAriaCurrent]);
  const prefetch = useCallback(() => {
    if (!util.isLikelyHttpURL(href) && !prefetched.has(href)) {
      events.emit("moduleprefetch", { href });
      prefetched.add(href);
    }
  }, [href]);
  const timerRef = useRef<number | null>(null);
  const onMouseEnter = (e: MouseEvent) => {
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
      }, 150);
    }
  };
  const onMouseLeave = (e: MouseEvent) => {
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
  };
  const onClick = (e: MouseEvent) => {
    if (typeof propOnClick === "function") {
      propOnClick(e);
    }
    if (e.defaultPrevented || isModifiedEvent(e)) {
      return;
    }
    e.preventDefault();
    redirect(href, replace);
  };

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
      ref: innerRef,
    },
    children,
  );
}

export type NavLinkProps = LinkProps & {
  exact?: boolean;
  activeClassName?: string;
  activeStyle?: CSSProperties;
};

/**
 * A special version of the `<Link>` that will add styling attributes to the rendered element when it matches the current URL.
 */
export function NavLink(props: NavLinkProps) {
  const { to, exact, className: propClassName, style: propStyle, activeStyle, activeClassName, ...rest } = props;
  const { url } = useRouter();
  const isActivated = useMemo(() => {
    if (!util.isFilledString(to)) {
      return false;
    }

    const [p, q] = util.splitBy(to, "?");
    const currentPathname = util.trimSuffix(url.pathname, "/");
    let pathname: string;
    if (p.startsWith("/")) {
      pathname = util.cleanPath(p);
    } else {
      pathname = util.cleanPath(currentPathname + "/" + p);
    }
    if (!exact) {
      return pathname === currentPathname || currentPathname.startsWith(pathname + "/");
    }
    return pathname === currentPathname && q === url.searchParams.toString();
  }, [url.pathname, url.searchParams, to, exact]);
  const className = useMemo(() => {
    if (!isActivated || !activeClassName) {
      return propClassName;
    }
    return [propClassName, activeClassName].filter(util.isFilledString).join(" ");
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
