var _a;
var _b;
_b = $RefreshSig$();
// ? should generate signature for built-in hooks
export function ContextTest() {
    _b();
    const ctx = useContext(expr);
    const { val } = useContext(expr2, extra);
    useContext(expr3);
}
_a = ContextTest;
$RefreshReg$(_a, "ContextTest");
_b(ContextTest, `useContext{ctx}
useContext{{ val }}
useContext{}`);
