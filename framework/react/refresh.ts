/** @format */

// react-refresh
// @link https://github.com/facebook/react/issues/16604#issuecomment-528663101

import runtime from "https://esm.sh/v126/react-refresh@0.14.0/runtime";

let timer: number | null;
const refresh = () => {
  if (timer !== null) {
    clearTimeout(timer);
  }
  timer = setTimeout(() => {
    runtime.performReactRefresh();
    timer = null;
  }, 50);
};

runtime.injectIntoGlobalHook(window);

Object.assign(window, {
  $RefreshReg$: () => {},
  $RefreshSig$: () => (type: unknown) => type,
});

export { refresh as __REACT_REFRESH__, runtime as __REACT_REFRESH_RUNTIME__ };
