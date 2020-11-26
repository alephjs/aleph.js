import { StyleHTMLAttributes } from 'https://esm.sh/react'

type StyleProps = StyleHTMLAttributes<{}> & { __inlineStyle?: string }

export default function Style({ children, __inlineStyle: id }: StyleProps) {
    if (window.Deno) {
        const css = children?.toLocaleString()
        if (css && id) {
            serverStyles.set('#' + id, { css })
        }
    }

    return null
}

export const serverStyles: Map<string, { css: string, asLink?: boolean }> = new Map()

export function applyCSS(id: string, css: string, asLink: boolean = false) {
    if (window.Deno) {
        serverStyles.set(id, { css, asLink })
    } else {
        const { document } = (window as any)
        const styleEl = document.createElement(asLink ? 'link' : 'style')
        const prevStyleEls = Array.from(document.head.children).filter((el: any) => el.getAttribute('data-module-id') === id)
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
