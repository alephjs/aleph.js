import { Options, renderSync } from 'https://esm.sh/sass@1.32.5'
import type { LoaderPlugin } from '../types.ts'

const pluginFactory = (opts: Options = {}): LoaderPlugin => ({
    type: 'loader',
    loader: 'css',
    test: /.(sass|scss)$/,
    acceptHMR: true,
    precompile(content: Uint8Array, path: string) {
        const ret = renderSync({
            indentedSyntax: path.endsWith('.sass'),
            ...opts,
            file: path,
            data: (new TextDecoder).decode(content),
            sourceMap: true
        })
        return {
            code: (new TextDecoder).decode(ret.css),
            map: ret.map ? (new TextDecoder).decode(ret.map) : undefined,
        }
    }
})

// make the `pluginFactory` function as a plugin
const defaultPlugin = pluginFactory()
pluginFactory.loader = defaultPlugin.loader
pluginFactory.test = defaultPlugin.test
pluginFactory.acceptHMR = defaultPlugin.acceptHMR
pluginFactory.precompile = defaultPlugin.precompile

export default pluginFactory
