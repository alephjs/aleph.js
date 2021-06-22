import { getAlephPkgUri } from '../../server/helper.ts'
import type { ServerApplication } from '../../types.ts'

export async function init(app: ServerApplication) {
  if (app.mode === 'development') {
    const alephPkgUri = getAlephPkgUri()
    const alephPkgPath = alephPkgUri.replace('https://', '').replace('http://localhost:', 'http_localhost_')
    await app.addModule(`${alephPkgUri}/framework/react/refresh.ts`)
    app.injectCode('compilation', '/main.js', (_: string, code: string) => ({
      code: [
        `import "./-/${alephPkgPath}/framework/react/refresh.js";`,
        code
      ].join('\n')
    }))
    app.injectCode('hmr', (specifier: string, code: string) => ({
      code: code.includes('$RefreshReg$(') ? [
        'const prevRefreshReg = $RefreshReg$;',
        'const prevRefreshSig = $RefreshSig$;',
        `window.$RefreshReg$ = (type, id) => __REACT_REFRESH_RUNTIME__.register(type, ${JSON.stringify(specifier)} + "#" + id);`,
        'window.$RefreshSig$ = __REACT_REFRESH_RUNTIME__.createSignatureFunctionForTransform;',
        '',
        code,
        'window.$RefreshReg$ = prevRefreshReg;',
        'window.$RefreshSig$ = prevRefreshSig;',
        'import.meta.hot.accept(__REACT_REFRESH__);'
      ].join('\n') : code
    }))
    // support ssr
    Object.assign(globalThis, {
      $RefreshReg$: () => { },
      $RefreshSig$: () => (type: any) => type,
    })
  }
}
