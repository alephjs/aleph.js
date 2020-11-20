var _a;
var _b;
_b = $RefreshSig$();
// ? should generate signature for built-in hooks
export function CallbackTest() {
    _b();
    const x = useCallback(() => { });
    const [p] = [useCallback(a, [a, b])];
}
_a = CallbackTest;
$RefreshReg$(_a, "CallbackTest");
_b(CallbackTest, `useCallback{x}
useCallback{}`);
