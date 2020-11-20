var _a;
var _b, _c, _d;
_b = $RefreshSig$();
_c = $RefreshSig$();
_d = $RefreshSig$();
// ? includes custom hooks into the signatures
function useFancyState() {
    _b();
    const [foo, setFoo] = React.useState(0);
    useFancyEffect();
    return foo;
}
_b(useFancyState, `useState{[foo, setFoo](0)}
useFancyEffect{}`, false, () => [useFancyEffect]);
const useFancyEffect = _c(() => {
    _c();
    React.useEffect(() => { });
}, "useEffect{}");
export default function App() {
    _d();
    const bar = useFancyState();
    return <h1>{bar}</h1>;
}
_a = App;
$RefreshReg$(_a, "App");
_d(App, "useFancyState{bar}", false, () => [useFancyState]);
