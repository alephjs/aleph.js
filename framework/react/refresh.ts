// react-refresh
// @link https://github.com/facebook/react/issues/16604#issuecomment-528663101

import runtime from "https://esm.sh/react-refresh@0.11.0/runtime";

const debounce = (callback: CallableFunction, delay: number) => {
  let timer: number | null = null;
  return (...args: unknown[]) => {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      callback(...args);
    }, delay);
  };
};
const refresh = debounce(runtime.performReactRefresh, 30);

runtime.injectIntoGlobalHook(window);
Object.assign(window, {
  $RefreshReg$: () => {},
  $RefreshSig$: () => (type: any) => type,
});

export { refresh as __REACT_REFRESH__, runtime as __REACT_REFRESH_RUNTIME__ };
