import { renderSync } from 'https://esm.sh/sass@1.29.0'

export default {
    name: 'sass-loader',
    test: /.(sass|scss)$/,
    acceptHMR: true,
    transform(content: Uint8Array, path: string) {
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
