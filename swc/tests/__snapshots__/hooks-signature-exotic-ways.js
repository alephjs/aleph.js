var _a;
var _b;
_b = $RefreshSig$();
// ? generates valid signature for exotic ways to call Hooks
import FancyHook from 'fancy';
export default function App() {
    _b();
    var _c;
    _c = $RefreshSig$();
    function useFancyState() {
        _c();
        const [foo, setFoo] = React.useState(0);
        useFancyEffect();
        return foo;
    }
    _c(useFancyState, `useState{[foo, setFoo](0)}
useFancyEffect{}`, true);
    const bar = useFancyState();
    const baz = FancyHook.useThing();
    React.useState();
    useThePlatform();
    return (<h1>
            {bar}
            {baz}
        </h1>);
}
_a = App;
$RefreshReg$(_a, "App");
_b(App, `useFancyState{bar}
FancyHook.useThing{baz}
useState{}
useThePlatform{}`, true);
