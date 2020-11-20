var _a;
var _b;
_b = $RefreshSig$();
// ? generates signatures for function declarations calling hooks
export default function App() {
    _b();
    const [foo, setFoo] = useState(0);
    React.useEffect(() => { });
    return <h1>{foo}</h1>;
}
_a = App;
$RefreshReg$(_a, "App");
_b(App, `useState{[foo, setFoo](0)}
useEffect{}`);
