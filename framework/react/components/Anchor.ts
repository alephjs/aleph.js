import {
  AnchorHTMLAttributes,
  CSSProperties,
  createElement,
  MouseEvent,
  PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
} from 'https://esm.sh/react@17.0.2'
import util from '../../../shared/util.ts'
import events from '../../core/events.ts'
import { redirect } from '../../core/redirect.ts'
import { useRouter } from '../hooks.ts'

const prefetchedPages = new Set<string>()

type AnchorProps = PropsWithChildren<AnchorHTMLAttributes<{}> & {
  'data-active-className'?: string
  'data-active-style'?: CSSProperties
}>

/**
 * Anchor Component to link between pages.
 */
export default function Anchor(props: AnchorProps) {
  const {
    rel,
    href: propHref,
    ['aria-current']: propAriaCurrent,
    ['data-active-className']: activeClassName = 'active',
    ['data-active-style']: activeStyle,
    className: propClassName,
    style: propStyle,
    onClick: propOnClick,
    onMouseEnter: propOnMouseEnter,
    children,
    ...rest
  } = props
  const relKeys = useMemo(() => rel ? rel.split(' ') : [], [rel])
  const prefetching = useMemo(() => relKeys.includes('prefetch'), [relKeys])
  const replace = useMemo(() => relKeys.includes('replace'), [relKeys])
  const isNav = useMemo(() => relKeys.includes('nav'), [relKeys])
  const { pathname, params, query } = useRouter()
  const href = useMemo(() => {
    if (!util.isFilledString(propHref)) {
      return ''
    }
    if (util.isLikelyHttpURL(propHref)) {
      return propHref
    }
    let [p, q] = util.splitBy(propHref, '?')
    if (p.startsWith('/')) {
      p = util.cleanPath(p)
    } else {
      p = util.cleanPath(pathname + '/' + p)
    }
    return [p, q].filter(Boolean).join('?')
  }, [pathname, propHref])
  const isCurrent = useMemo(() => {
    if (!util.isFilledString(propHref)) {
      return false
    }

    const [p, q] = util.splitBy(propHref, '?')
    if (util.trimSuffix(p, '/') !== pathname) {
      return false
    }

    const search = new URLSearchParams(q)
    search.sort()
    if (search.toString() !== query.toString()) {
      return false
    }

    return true
  }, [pathname, params, query, propHref])
  const className = useMemo(() => {
    if (!isNav || !isCurrent) {
      return propClassName
    }
    return [propClassName, activeClassName].filter(util.isFilledString).map(n => n.trim()).filter(Boolean).join(' ')
  }, [propClassName, activeClassName, isCurrent, isNav])
  const style = useMemo(() => {
    if (!isNav || !isCurrent) {
      return propStyle
    }
    return Object.assign({}, propStyle, activeStyle)
  }, [propStyle, activeStyle, isCurrent, isNav])
  const ariaCurrent = useMemo(() => {
    if (util.isFilledString(propAriaCurrent)) {
      return propAriaCurrent
    }
    if (href.startsWith('/')) {
      return 'page'
    }
    return undefined
  }, [href, propAriaCurrent])
  const prefetch = useCallback(() => {
    if (href && !util.isLikelyHttpURL(href) && !isCurrent && !prefetchedPages.has(href)) {
      events.emit('fetch-page-module', { href })
      prefetchedPages.add(href)
    }
  }, [isCurrent])
  const onMouseEnter = useCallback((e: MouseEvent) => {
    if (util.isFunction(propOnMouseEnter)) {
      propOnMouseEnter(e)
    }
    if (e.defaultPrevented) {
      return
    }
    prefetch()
  }, [prefetch])
  const onClick = useCallback((e: MouseEvent) => {
    if (util.isFunction(propOnClick)) {
      propOnClick(e)
    }
    if (e.defaultPrevented || isModifiedEvent(e)) {
      return
    }
    e.preventDefault()
    if (!isCurrent) {
      redirect(href, replace)
    }
  }, [isCurrent, href, replace])

  useEffect(() => {
    if (prefetching) {
      prefetch()
    }
  }, [prefetching, prefetch])

  return createElement(
    'a',
    {
      ...rest,
      className,
      style,
      href,
      onClick,
      onMouseEnter,
      'aria-current': ariaCurrent
    },
    children
  )
}

function isModifiedEvent(event: MouseEvent): boolean {
  const { target } = event.currentTarget as any
  const nativeEvent = event.nativeEvent as any
  return (
    (target && target !== '_self') ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey || // triggers resource download
    (nativeEvent && nativeEvent.which === 2)
  )
}
