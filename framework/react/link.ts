import {
  AnchorHTMLAttributes,
  createElement,
  CSSProperties,
  MouseEvent,
  PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
} from "https://esm.sh/react@17.0.2";
import util from "../../lib/util.ts";
import events from "../core/events.ts";
import { redirect } from "../core/redirect.ts";
import { useRouter } from "./router.ts";

const prefetchedPages = new Set<string>();

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
    to: propHref,
    prefetch: propPrefetch,
    replace,
    className,
    style,
    onClick: propOnClick,
    onMouseEnter: propOnMouseEnter,
    ["aria-current"]: propAriaCurrent,
    children,
    ...rest
  } = props;
  const { url: { pathname, searchParams } } = useRouter();
  const href = useMemo(() => {
    if (!util.isFilledString(propHref)) {
      return "";
    }
    if (util.isLikelyHttpURL(propHref)) {
      return propHref;
    }
    let [p, q] = util.splitBy(propHref, "?");
    if (p.startsWith("/")) {
      p = util.cleanPath(p);
    } else {
      p = util.cleanPath(pathname + "/" + p);
    }
    return [p, q].filter(Boolean).join("?");
  }, [pathname, propHref]);
  const isCurrent = useMemo(() => {
    if (!util.isFilledString(propHref)) {
      return false;
    }

    const [p, q] = util.splitBy(propHref, "?");
    if (util.trimSuffix(p, "/") !== pathname) {
      return false;
    }

    const search = new URLSearchParams(q);
    search.sort();
    if (search.toString() !== searchParams.toString()) {
      return false;
    }

    return true;
  }, [pathname, searchParams, propHref]);
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
    if (
      href && !util.isLikelyHttpURL(href) && !isCurrent &&
      !prefetchedPages.has(href)
    ) {
      events.emit("fetch-page-module", { href });
      prefetchedPages.add(href);
    }
  }, [isCurrent]);
  const onMouseEnter = useCallback((e: MouseEvent) => {
    if (typeof propOnMouseEnter === "function") {
      propOnMouseEnter(e);
    }
    if (e.defaultPrevented) {
      return;
    }
    prefetch();
  }, [prefetch]);
  const onClick = useCallback((e: MouseEvent) => {
    if (typeof propOnClick === "function") {
      propOnClick(e);
    }
    if (e.defaultPrevented || isModifiedEvent(e)) {
      return;
    }
    e.preventDefault();
    if (!isCurrent) {
      redirect(href, replace);
    }
  }, [isCurrent, href, replace]);

  useEffect(() => {
    if (propPrefetch) {
      prefetch();
    }
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
      "aria-current": ariaCurrent,
    },
    children,
  );
}

/**
 * Link Component to link between pages.
 */
export function NavLink(props: LinkProps & { activeClassName?: string; activeStyle?: CSSProperties }) {
  const {
    to: propHref,
    className: propClassName,
    style: propStyle,
    activeStyle,
    activeClassName,
  } = props;
  const { url: { pathname, searchParams } } = useRouter();
  const isCurrent = useMemo(() => {
    if (!util.isFilledString(propHref)) {
      return false;
    }

    const [p, q] = util.splitBy(propHref, "?");
    if (util.trimSuffix(p, "/") !== pathname) {
      return false;
    }

    const search = new URLSearchParams(q);
    search.sort();
    if (search.toString() !== searchParams.toString()) {
      return false;
    }

    return true;
  }, [pathname, searchParams, propHref]);
  const className = useMemo(() => {
    if (!isCurrent) {
      return propClassName;
    }
    return [propClassName, activeClassName].filter(util.isFilledString).map(
      (n) => n.trim(),
    ).filter(Boolean).join(" ");
  }, [propClassName, activeClassName, isCurrent]);
  const style = useMemo(() => {
    if (!isCurrent) {
      return propStyle;
    }
    return Object.assign({}, propStyle, activeStyle);
  }, [propStyle, activeStyle, isCurrent]);

  return createElement(
    Link,
    {
      ...props,
      className,
      style,
    },
  );
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
