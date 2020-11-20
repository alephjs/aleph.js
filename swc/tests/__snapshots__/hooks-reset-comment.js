var _a, _b;
var _c, _d;
_c = $RefreshSig$();
_d = $RefreshSig$();
// ? should recognize reset comment
// @refresh reset
function App() {
    _c();
    useState(0);
}
_a = App;
$RefreshReg$(_a, "App");
_c(App, "useState{(0)}", true);
// Should not be reset?
function Not() {
    _d();
    useState(0);
}
_b = Not;
$RefreshReg$(_b, "Not");
_d(Not, "useState{(0)}", true);
