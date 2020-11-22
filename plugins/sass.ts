import { Options, renderSync } from 'https://esm.sh/sass@1.29.0'

const defaultPlugin = {
    name: 'sass-loader',
    test: /.(sass|scss)$/,
    acceptHMR: true,
    transform(content: Uint8Array, path: string) {
        const ret = renderSync({
            file: path,
            data: (new TextDecoder).decode(content),
            sourceMap: true,
            indentedSyntax: path.endsWith('.sass')
        })
        return {
            code: (new TextDecoder).decode(ret.css),
            map: ret.map ? (new TextDecoder).decode(ret.map) : undefined,
            loader: 'css'
        }
    }
}

const pluginFactory = (opts: Options) => ({
    ...defaultPlugin,
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

pluginFactory.displayName = defaultPlugin.name
pluginFactory.test = defaultPlugin.test
pluginFactory.acceptHMR = defaultPlugin.acceptHMR
pluginFactory.transform = defaultPlugin.transform

export default pluginFactory
