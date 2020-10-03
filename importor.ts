import React, { useEffect } from 'https://esm.sh/react'
import util, { reStyleModuleExt } from './util.ts'

const serverImports: Set<string> = new Set()

// reset imports and returns them
export function resetImports() {
    const a = Array.from(serverImports)
    serverImports.clear()
    return a
}

interface ImportProps {
    from: string
}

export function Import(props: ImportProps) {
    const { from: path, rawPath, resolveDir } = props as any
    if (reStyleModuleExt.test(rawPath)) {
        return React.createElement(StyleLoader, { path: util.cleanPath(`${resolveDir}/${path}`), rawPath })
    }
    // todo: more loaders
    return null
}

interface LoaderProps {
    path: string
    rawPath: string
}

export function StyleLoader({ path }: LoaderProps) {
    if (typeof Deno !== 'undefined') {
        serverImports.add(path)
    }

    useEffect(() => {
        import(`/_aleph${path}`)
        return () => { }
    }, [])

    return null
}
