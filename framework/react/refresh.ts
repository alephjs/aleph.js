export const refreshRuntime = `// react-refresh
// @link https://github.com/facebook/react/issues/16604#issuecomment-528663101

import runtime from "https://esm.sh/react-refresh@0.11.0/runtime";

const debounce = (callback, delay)=> {
  let timer = null;
  return (...args) => {
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
window.$RefreshReg$ = () => { };
window.$RefreshSig$ = () => (type) => type;

export { runtime as __REACT_REFRESH_RUNTIME__, refresh as __REACT_REFRESH__ }
`;
