// react-refresh
// @link https://github.com/facebook/react/issues/16604#issuecomment-528663101

import runtime from "https://esm.sh/react-refresh@0.11.0/runtime";
import util from "../../lib/util.ts";

const refresh = util.debounce(runtime.performReactRefresh, 30);

runtime.injectIntoGlobalHook(window);
Object.assign(window, {
  $RefreshReg$: () => {},
  $RefreshSig$: () => (type: unknown) => type,
});

export { refresh as __REACT_REFRESH__, runtime as __REACT_REFRESH_RUNTIME__ };
