import { Options, renderSync } from 'https://esm.sh/sass@1.29.0'

const defaultOptions = {
    name: 'sass-loader',
    test: /.(sass|scss)$/,
    acceptHMR: true,
    transform(content: Uint8Array, path: string) {
        if (path.endsWith('.sass')) {
            const ret = renderSync({
                file: path,
                data: (new TextDecoder).decode(content),
                sourceMap: true,
                indentedSyntax: true
            })
            return {
                code: (new TextDecoder).decode(ret.css),
                map: ret.map ? (new TextDecoder).decode(ret.map) : undefined,
                loader: 'css'
            }
        } else {
            const ret = renderSync({
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
    }
}

let plugin: any = (opts: Options) => ({
    name: 'sass-loader',
    test: /.(sass|scss)$/,
    acceptHMR: true,
    transform(content: Uint8Array, path: string) {
        if (path.endsWith('.sass')) {
            const ret = renderSync({
                ...opts,
                file: path,
                data: (new TextDecoder).decode(content),
                sourceMap: true,
                indentedSyntax: true
            })
            return {
                code: (new TextDecoder).decode(ret.css),
                map: ret.map ? (new TextDecoder).decode(ret.map) : undefined,
                loader: 'css'
            }
        } else {
            const ret = renderSync({
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
    }
})

plugin = { ...plugin, ...defaultOptions }

export default plugin;