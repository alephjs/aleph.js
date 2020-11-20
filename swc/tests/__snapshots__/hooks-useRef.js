var _a;
var _b;
_b = $RefreshSig$();
// ? should generate signature for built-in hooks
export function RefTest() {
    _b();
    const ref = useRef();
    const ref2 = useRef(complex.expr(1), extra);
    const { current } = React.useRef();
}
_a = RefTest;
$RefreshReg$(_a, "RefTest");
_b(RefTest, `useRef{ref}
useRef{ref2}
useRef{{ current }}`);
