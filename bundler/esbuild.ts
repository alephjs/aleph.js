// @deno-types="https://deno.land/x/esbuild@v0.12.28/mod.d.ts"
import { build, stop, Plugin } from 'https://deno.land/x/esbuild@v0.12.28/mod.js'
import { join } from 'https://deno.land/std@0.106.0/path/mod.ts'
import { cache } from '../server/cache.ts'
import util from '../shared/util.ts'

export {
  build as esbuild,
  stop as stopEsbuild
}

export const cssPlugin: Plugin = {
  name: 'css-resolver',
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

      // ensure the `path` is an absolute path
      if (!path.startsWith('/')) {
        return { path: join(args.resolveDir, path) }
      }

      return { path }
    })
  }
}

export const denoPlugin: Plugin = {
  name: 'deno-resolve-loader',
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
          namespace: 'http',
        }
      }

      if (args.namespace === 'http') {
        return {
          path: (new URL(path, args.importer)).toString(),
          namespace: 'http',
        }
      }

      // ensure the `path` is an absolute path
      if (!path.startsWith('/')) {
        return { path: join(args.resolveDir, path) }
      }

      return { path }
    })

    build.onLoad({ filter: /.*/, namespace: 'http' }, async args => {
      const { content } = await cache(args.path)
      return { contents: content }
    })
  }
}
