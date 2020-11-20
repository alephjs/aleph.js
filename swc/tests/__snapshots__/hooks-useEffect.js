var _a;
var _b;
_b = $RefreshSig$();
// ? should generate signature for built-in hooks
export function EffectTest() {
    _b();
    const rtn = useEffect();
    useEffect(expr, [deps]);
    useEffect(() => {
        do_some();
    });
    useEffect(() => (sideEffect(), () => undo()));
}
_a = EffectTest;
$RefreshReg$(_a, "EffectTest");
_b(EffectTest, `useEffect{rtn}
useEffect{}
useEffect{}
useEffect{}`);
