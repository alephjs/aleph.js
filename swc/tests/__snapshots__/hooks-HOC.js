var _a, _b, _c, _d, _e, _f;
var _g, _h;
_g = $RefreshSig$();
_h = $RefreshSig$();
// ? generates signatures for function expressions calling hooks
export const A = React.memo(_a = React.forwardRef(_b = _g((props, ref) => {
    _g();
    const [foo, setFoo] = useState(0);
    React.useEffect(() => { });
    return <h1 ref={ref}>{foo}</h1>;
}, `useState{[foo, setFoo](0)}
useEffect{}`)));
$RefreshReg$(_b, "A$React.memo$React.forwardRef");
$RefreshReg$(_a, "A$React.memo");
_c = A;
$RefreshReg$(_c, "A");
export const B = React.memo(_d = React.forwardRef(_e = _h(function (props, ref) {
    _h();
    const [foo, setFoo] = useState(0);
    React.useEffect(() => { });
    return <h1 ref={ref}>{foo}</h1>;
}, `useState{[foo, setFoo](0)}
useEffect{}`)));
$RefreshReg$(_e, "B$React.memo$React.forwardRef");
$RefreshReg$(_d, "B$React.memo");
_f = B;
$RefreshReg$(_f, "B");
function hoc() {
    var _j;
    _j = $RefreshSig$();
    return _j(function Inner() {
        _j();
        const [foo, setFoo] = useState(0);
        React.useEffect(() => { });
        return <h1 ref={ref}>{foo}</h1>;
    }, `useState{[foo, setFoo](0)}
useEffect{}`);
}
export let C = hoc();
