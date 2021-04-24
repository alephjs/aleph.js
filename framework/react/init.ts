import { dirname } from 'https://deno.land/std@0.94.0/path/mod.ts'
import { getAlephPkgUri, getRelativePath, toLocalPath } from '../../server/helper.ts'
import util from '../../shared/util.ts'
import type { ServerApplication } from '../../types.ts'

export async function init(app: ServerApplication) {
  if (app.mode === 'development') {
    const alephPkgUri = getAlephPkgUri()
    app.injectCode('hmr', (url: string, code: string) => {
      if (code.includes('$RefreshReg$(')) {
        const refreshModuleUrl = getRelativePath(
          dirname(toLocalPath(url)),
          toLocalPath(`${alephPkgUri}/framework/react/refresh.js`)
        )
        return [
          `import { RefreshRuntime, performReactRefresh } from ${JSON.stringify(refreshModuleUrl)};`,
          '',
          'const prevRefreshReg = window.$RefreshReg$;',
          'const prevRefreshSig = window.$RefreshSig$;',
          `window.$RefreshReg$ = (type, id) => RefreshRuntime.register(type, ${JSON.stringify(url)} + "#" + id);`,
          'window.$RefreshSig$ = RefreshRuntime.createSignatureFunctionForTransform;',
          '',
          util.trimSuffix(code.trim(), 'import.meta.hot.accept();'),
          'window.$RefreshReg$ = prevRefreshReg;',
          'window.$RefreshSig$ = prevRefreshSig;',
          'import.meta.hot.accept(performReactRefresh);'
        ].join('\n')
      }
      return code
    })
    app.injectCode('compilation', (url: string, code: string) => {
      if (url === '/main.js') {
        return [
          `import ".${toLocalPath(`${alephPkgUri}/framework/react/refresh.js`)}";`,
          code
        ].join('\n')
      }
      return code
    })
    await app.addModule(`${alephPkgUri}/framework/react/refresh.ts`)
    Object.assign(globalThis, {
      $RefreshReg$: () => { },
      $RefreshSig$: () => (type: any) => type,
    })
  }
}
