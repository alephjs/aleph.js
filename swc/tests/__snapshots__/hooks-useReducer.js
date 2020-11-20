var _a;
var _b;
_b = $RefreshSig$();
// ? should generate signature for built-in hooks
export function ReducerTest() {
    _b();
    const [state, dispatch] = useReducer(reducer, initArg, init, extra);
    useReducer();
}
_a = ReducerTest;
$RefreshReg$(_a, "ReducerTest");
_b(ReducerTest, `useReducer{[state, dispatch](initArg)}
useReducer{}`);
