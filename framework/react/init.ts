import { path } from '../../deps.ts'
import { getAlephPkgUri, getRelativePath, toLocalUrl } from '../../server/helper.ts'
import util from '../../shared/util.ts'
import type { ServerApplication } from '../../types.ts'

export async function init(app: ServerApplication) {
  if (app.mode === 'development') {
    const alephPkgUri = getAlephPkgUri()
    app.injectCode('hmr', (url: string, code: string) => {
      const reactRefresh = code.includes('$RefreshSig$') || code.includes('$RefreshReg$')
      if (reactRefresh) {
        const refreshModuleUrl = getRelativePath(
          path.dirname(toLocalUrl(url)),
          toLocalUrl(`${alephPkgUri}/framework/react/refresh.js`)
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
          `import '.${toLocalUrl(`${alephPkgUri}/framework/react/refresh.js`)}';`,
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
