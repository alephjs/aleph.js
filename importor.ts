import React, { useEffect } from 'https://esm.sh/react'
import util, { reStyleModuleExt } from './util.ts'

const serverImports: Set<string> = new Set()

export async function importAll() {
    const { appDir, buildID } = (window as any).ALEPH_ENV as { appDir: string, buildID: string }
    for (const p of serverImports.values()) {
        await import('file://' + util.cleanPath(`${appDir}/.aleph/build-${buildID}/${p}`))
    }
    serverImports.clear()
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
