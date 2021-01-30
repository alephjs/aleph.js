import type { AnchorHTMLAttributes, CSSProperties, MouseEvent, PropsWithChildren } from 'https://esm.sh/react'
import { createElement, useCallback, useEffect, useMemo } from 'https://esm.sh/react'
import util from '../../shared/util.ts'
import events from '../core/events.ts'
import { isHttpUrl, redirect } from '../core/routing.ts'
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
    const { pathname: currentPathname, query: currentQuery } = useRouter()
    const currentHref = useMemo(() => {
        return [currentPathname, currentQuery.toString()].filter(Boolean).join('?')
    }, [currentPathname, currentQuery])
    const href = useMemo(() => {
        if (!util.isNEString(propHref)) {
            return ''
        }
        if (isHttpUrl(propHref)) {
            return propHref
        }
        let [pathname, search] = util.splitBy(propHref, '?')
        if (pathname.startsWith('/')) {
            pathname = util.cleanPath(pathname)
        } else {
            pathname = util.cleanPath(currentPathname + '/' + pathname)
        }
        return [pathname, search].filter(Boolean).join('?')
    }, [currentPathname, propHref])
    const className = useMemo(() => {
        if (!isNav || currentHref !== href) {
            return propClassName
        }
        return [propClassName, activeClassName].filter(util.isNEString).map(n => n.trim()).filter(Boolean).join(' ')
    }, [propClassName, activeClassName, currentHref, href, isNav])
    const style = useMemo(() => {
        if (!isNav || currentHref !== href) {
            return propStyle
        }
        return Object.assign({}, propStyle, activeStyle)
    }, [propStyle, activeStyle, currentHref, href, isNav])
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
        if (href && !isHttpUrl(href) && href !== currentHref && !prefetchedPages.has(href)) {
            events.emit('fetch-page-module', { href })
            prefetchedPages.add(href)
        }
    }, [href, currentHref])
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
        if (href && href !== currentHref) {
            redirect(href, replace)
        }
    }, [href, currentHref, replace])

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
