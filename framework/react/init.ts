import { getAlephPkgUri } from '../../server/helper.ts'
import type { Aleph } from '../../types.d.ts'

export async function init(aleph: Aleph) {
  if (aleph.mode === 'development') {
    const alephPkgUri = getAlephPkgUri()
    const refreshModule = await aleph.addModule(`${alephPkgUri}/framework/react/refresh.ts`, `
      import runtime from 'https://esm.sh/react-refresh@0.10.0/runtime'
      import util from '../../shared/util.ts'

      // react-refresh
      // @link https://github.com/facebook/react/issues/16604#issuecomment-528663101
      runtime.injectIntoGlobalHook(window)
      Object.assign(window, {
        $RefreshReg$: () => { },
        $RefreshSig$: () => (type: any) => type,
        __REACT_REFRESH_RUNTIME__: runtime,
        __REACT_REFRESH__: util.debounce(runtime.performReactRefresh, 30)
      })
    `)
    aleph.onTransform('main', ({ code }) => ({
      code: [
        `import ".${refreshModule.jsFile}";`,
        code
      ].join('\n')
    }))
    aleph.onTransform('hmr', ({ module: { specifier }, code }) => ({
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
