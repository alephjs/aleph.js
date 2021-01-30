import type { StyleHTMLAttributes } from 'https://esm.sh/react'
import { useEffect } from 'https://esm.sh/react'

const { document } = window as any

export const serverStyles: Map<string, string> = new Map()

export default function Style({ children, ...rest }: StyleHTMLAttributes<{}>) {
    const css = children?.toLocaleString()
    const { __styleId: id } = rest as any

    if (css && id) {
        if (window.Deno) {
            serverStyles.set('#' + id, css)
        } else {
            const ssrStyle = Array.from<any>(document.head.children).find((el: any) => {
                return el.getAttribute('data-module-id') === '#' + id && el.hasAttribute('ssr')
            })
            if (ssrStyle) {
                ssrStyle.removeAttribute('ssr')
            } else {
                const prevStyleEls = Array.from(document.head.children).filter((el: any) => {
                    return el.getAttribute('data-module-id') === '#' + id
                })
                const styleEl = document.createElement('style')
                styleEl.type = 'text/css'
                styleEl.setAttribute('data-module-id', '#' + id)
                styleEl.appendChild(document.createTextNode(css))
                document.head.appendChild(styleEl)
                if (prevStyleEls.length > 0) {
                    setTimeout(() => {
                        prevStyleEls.forEach(el => document.head.removeChild(el))
                    }, 0)
                }
            }
        }
    }

    useEffect(() => () => {
        if (id) {
            Array.from(document.head.children).forEach((el: any) => {
                if (el.getAttribute('data-module-id') === '#' + id) {
                    document.head.removeChild(el)
                }
            })
        }
    }, [id])

    return null
}

export function applyCSS(id: string, css: string) {
    if (window.Deno) {
        serverStyles.set(id, css)
    } else {
        const ssrStyle = Array.from<any>(document.head.children).find((el: any) => {
            return el.getAttribute('data-module-id') === id && el.hasAttribute('ssr')
        })
        if (ssrStyle) {
            ssrStyle.removeAttribute('ssr')
        } else {
            const prevStyleEls = Array.from(document.head.children).filter((el: any) => {
                return el.getAttribute('data-module-id') === id
            })
            const styleEl = document.createElement('style')
            styleEl.type = 'text/css'
            styleEl.appendChild(document.createTextNode(css))
            styleEl.setAttribute('data-module-id', id)
            document.head.appendChild(styleEl)
            if (prevStyleEls.length > 0) {
                setTimeout(() => {
                    prevStyleEls.forEach(el => document.head.removeChild(el))
                }, 0)
            }
        }
    }
}
