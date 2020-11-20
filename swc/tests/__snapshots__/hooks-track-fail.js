var _a;
var _b;
_b = $RefreshSig$();
// ? should track custom hooks
function App() {
    _b();
    var _c, _d;
    _c = $RefreshSig$();
    _d = $RefreshSig$();
    function useLocal() {
        _c();
        return useState(0);
    }
    _c(useLocal, "useState{(0)}");
    const useLocal2 = _d(() => (_d(), useLocal()), "useLocal{}", false, () => [useLocal]);
    useLocal(useLocal2());
}
_a = App;
$RefreshReg$(_a, "App");
_b(App, `useLocal{}
useLocal2{}`, true);
