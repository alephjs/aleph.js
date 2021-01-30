import type { PropsWithChildren, ScriptHTMLAttributes } from 'https://esm.sh/react'
import { useContext } from 'https://esm.sh/react'
import { RendererContext } from './context.ts'

export default function Script(props: PropsWithChildren<ScriptHTMLAttributes<{}>>) {
    const renderer = useContext(RendererContext)

    if (window.Deno) {
        const key = 'script-' + (renderer.storage.scriptsElements.size + 1)
        renderer.storage.scriptsElements.set(key, { type: 'script', props })
    }

    // todo: insert page scripts in browser

    return null
}
