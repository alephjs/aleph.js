var _a;
var _b;
_b = $RefreshSig$();
// ? should generate signature for built-in hooks
export function MemoTest() {
    _b();
    const x = useMemo(() => { });
    const [p] = [useMemo(a, [a, b])];
}
_a = MemoTest;
$RefreshReg$(_a, "MemoTest");
_b(MemoTest, `useMemo{x}
useMemo{}`);
