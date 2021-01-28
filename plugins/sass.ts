import { Options, renderSync } from 'https://esm.sh/sass@1.32.5'
import type { Plugin } from '../types.ts'

const pluginFactory = (opts: Options = {}): Plugin => ({
    type: 'loader',
    name: 'sass-loader',
    test: /.(sass|scss)$/,
    acceptHMR: true,
    transform(content: Uint8Array, path: string) {
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
            loader: 'css'
        }
    }
})
const defaultPlugin = pluginFactory()

// make the `pluginFactory` as a plugin
pluginFactory.type = defaultPlugin.type
pluginFactory.test = defaultPlugin.test
pluginFactory.acceptHMR = defaultPlugin.acceptHMR
pluginFactory.transform = defaultPlugin.transform

export default pluginFactory
