var _a;
var _b, _c, _d;
_b = $RefreshSig$();
_c = $RefreshSig$();
_d = $RefreshSig$();
// ? should track custom hooks
function useLocal() {
    _b();
    return useState(0);
}
_b(useLocal, "useState{(0)}");
const useLocal2 = _c(() => (_c(), useLocal()), "useLocal{}", false, () => [useLocal]);
function App() {
    _d();
    useLocal(useLocal2());
}
_a = App;
$RefreshReg$(_a, "App");
_d(App, `useLocal{}
useLocal2{}`, false, () => [useLocal, useLocal2]);
