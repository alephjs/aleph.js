var _a;
var _b;
_b = $RefreshSig$();
// ? should generate signature for built-in hooks
export function StateTest() {
    _b();
    const a = useState(0, extra);
    const [b] = useState(complex + expression.f());
    const [c, d] = React.useState();
    const [[e], f] = useState([0]);
    const { 0: y, 1: z, length } = useState(() => {
        a();
        multiple();
        line();
        expression();
    });
}
_a = StateTest;
$RefreshReg$(_a, "StateTest");
_b(StateTest, `useState{a(0)}
useState{[b](complex + expression.f())}
useState{[c, d]}
useState{[[e], f]([0])}
useState{{ 0: y, 1: z, length }(() => {
        a()
        multiple()
        line()
        expression()
    })}`);
