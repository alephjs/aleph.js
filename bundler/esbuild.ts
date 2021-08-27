import { join } from 'https://deno.land/std@0.106.0/path/mod.ts'
import { cache } from '../server/cache.ts'
import util from '../shared/util.ts'
// @deno-types="https://deno.land/x/esbuild@v0.12.24/mod.d.ts"
import { build, stop, Plugin } from 'https://deno.land/x/esbuild@v0.12.24/mod.js'

export {
  build as esbuild,
  stop as stopEsbuild
}

export const esmLoader: Plugin = {
  name: 'esm-loader',
  setup(build) {
    build.onResolve({ filter: /.*/ }, args => {
      const isRemote = util.isLikelyHttpURL(args.path)
      const path = isRemote ? args.path : util.trimPrefix(args.path, 'file://')

      if (
        args.kind === 'url-token' ||
        (args.kind === 'import-rule' && (isRemote || path.startsWith('/')))
      ) {
        return { path: path, external: true }
      }
      if (isRemote) {
        return {
          path,
          namespace: 'http-module',
        }
      }
      if (args.namespace === 'http-module') {
        return {
          path: (new URL(path, args.importer)).toString(),
          namespace: 'http-module',
        }
      }
      if (path.startsWith('.')) {
        return { path: join(args.resolveDir, path) }
      }
      return { path }
    })
    build.onLoad({ filter: /.*/, namespace: 'http-module' }, async args => {
      const { content } = await cache(args.path)
      return { contents: content }
    })
  }
}
