import { StyleHTMLAttributes, useEffect } from 'https://esm.sh/react'

export const serverStyles: Map<string, { css: string, asLink?: boolean }> = new Map()

type StyleProps = StyleHTMLAttributes<{}> & { __styleId?: string }

export default function Style({ children, __styleId: id }: StyleProps) {
    const css = children?.toLocaleString()

    if (window.Deno) {
        if (css && id) {
            serverStyles.set('#' + id, { css })
        }
    }

    useEffect(() => {
        const { document } = (window as any)
        const styleEl = document.createElement('style')
        const ssrStyleEls = Array.from(document.head.children).filter((el: any) => {
            return el.getAttribute('data-module-id') === '#' + id && el.hasAttribute('ssr')
        })
        styleEl.type = 'text/css'
        styleEl.setAttribute('data-module-id', '#' + id)
        styleEl.appendChild(document.createTextNode(css))
        document.head.appendChild(styleEl)
        if (ssrStyleEls.length > 0) {
            setTimeout(() => {
                ssrStyleEls.forEach(el => document.head.removeChild(el))
            }, 0)
        }
        return () => {
            document.head.removeChild(styleEl)
            console.log('remove', id)
        }
    }, [css])

    return null
}

export function applyCSS(id: string, css: string, asLink: boolean = false) {
    if (window.Deno) {
        serverStyles.set(id, { css, asLink })
    } else {
        const { document } = (window as any)
        const styleEl = document.createElement(asLink ? 'link' : 'style')
        const prevStyleEls = Array.from(document.head.children).filter((el: any) => {
            return el.getAttribute('data-module-id') === id
        })
        if (asLink) {
            styleEl.rel = 'stylesheet'
            styleEl.href = css
        } else {
            styleEl.type = 'text/css'
            styleEl.appendChild(document.createTextNode(css))
        }
        styleEl.setAttribute('data-module-id', id)
        document.head.appendChild(styleEl)
        if (prevStyleEls.length > 0) {
            if (asLink) {
                styleEl.addEventListener('load', () => {
                    prevStyleEls.forEach(el => document.head.removeChild(el))
                })
            } else {
                setTimeout(() => {
                    prevStyleEls.forEach(el => document.head.removeChild(el))
                }, 0)
            }
        }
    }
}
