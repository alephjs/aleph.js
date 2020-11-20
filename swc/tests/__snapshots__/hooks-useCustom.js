var _a;
var _b;
_b = $RefreshSig$();
// ? should generate signature for custom hooks
function A() {
    _b();
    const [x] = useCustom(1, 2, 3);
    useCustom();
}
_a = A;
$RefreshReg$(_a, "A");
_b(A, `useCustom{[x]}
useCustom{}`, true);
