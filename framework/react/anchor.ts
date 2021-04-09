import {
  AnchorHTMLAttributes,
  CSSProperties,
  createElement,
  MouseEvent,
  PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
} from 'react'
import util from '../../shared/util.ts'
import events from '../core/events.ts'
import { redirect } from '../core/redirect.ts'
import { useRouter } from './hooks.ts'

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
    ['data-active-className']: activeClassName,
    ['data-active-style']: activeStyle,
    className: propClassName,
    style: propStyle,
    children,
    ...rest
  } = props
  const relKeys = useMemo(() => rel ? rel.split(' ') : [], [rel])
  const prefetching = useMemo(() => relKeys.includes('prefetch'), [relKeys])
  const replace = useMemo(() => relKeys.includes('replace'), [relKeys])
  const isNav = useMemo(() => relKeys.includes('nav'), [relKeys])
  const { pathname, params } = useRouter()
  const href = useMemo(() => {
    if (!util.isNEString(propHref)) {
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
    if (!util.isNEString(propHref)) {
      return false
    }

    const [p, q] = util.splitBy(propHref, '?')
    if (p !== pathname) {
      return false
    }
    if (q) {
      const search = new URLSearchParams(q)
      for (const key of search.keys()) {
        if (
          !params.has(key) ||
          search.getAll(key).join(',') !== params.getAll(key).join(',')
        ) {
          return false
        }
      }
    }
    return true
  }, [pathname, params, propHref])
  const className = useMemo(() => {
    if (!isNav || !isCurrent) {
      return propClassName
    }
    return [propClassName, activeClassName].filter(util.isNEString).map(n => n.trim()).filter(Boolean).join(' ')
  }, [propClassName, activeClassName, isCurrent, isNav])
  const style = useMemo(() => {
    if (!isNav || !isCurrent) {
      return propStyle
    }
    return Object.assign({}, propStyle, activeStyle)
  }, [propStyle, activeStyle, isCurrent, isNav])
  const ariaCurrent = useMemo(() => {
    if (util.isNEString(propAriaCurrent)) {
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
    if (util.isFunction(props.onMouseEnter)) {
      props.onMouseEnter(e)
    }
    if (e.defaultPrevented) {
      return
    }
    prefetch()
  }, [prefetch])
  const onClick = useCallback((e: MouseEvent) => {
    if (util.isFunction(props.onMouseEnter)) {
      props.onMouseEnter(e)
    }
    if (e.defaultPrevented) {
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
