import React, { useEffect } from 'https://esm.sh/react'
import type { Config } from './types.ts'
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
    rawPath: string
    resolveDir: string
}

export function Import({ from, rawPath, resolveDir }: ImportProps) {
    if (reStyleModuleExt.test(rawPath)) {
        return React.createElement(StyleLoader, { path: from, rawPath, resolveDir })
    }
    // todo: more loaders
    return null
}

interface LoaderProps {
    path: string
    rawPath: string
    resolveDir: string
}

export function StyleLoader({ path, rawPath, resolveDir }: LoaderProps) {
    if (typeof Deno !== 'undefined') {
        const { appDir, mode, config } = (window as any).ALEPH_ENV as { appDir: string, mode: string, config: Config }
        serverImports.add(util.cleanPath(`${appDir}/.aleph/${mode}.${config.buildTarget}/${resolveDir}/${path}`))
    }

    useEffect(() => {
        import(util.cleanPath(`/_aleph/${resolveDir}/${path}`))
        return () => { }
    }, [])

    return null
}
