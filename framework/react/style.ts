import type { StyleHTMLAttributes } from 'https://esm.sh/react'
import { useEffect } from 'https://esm.sh/react'
import { applyCSS, removeCSS } from "../core/style.ts"

export default function Style({ children, ...rest }: StyleHTMLAttributes<{}>) {
    const css = children?.toLocaleString()
    const { __styleId: id } = rest as any

    if (id && css) {
        applyCSS('#' + id, css)
    }

    useEffect(() => () => id && removeCSS('#' + id), [])

    return null
}
