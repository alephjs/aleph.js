var _a;
var _b;
_b = $RefreshSig$();
// ? includes custom hooks into the signatures when commonjs target is used
// Not applicable for TypeScript. TypeScript one requires runs _before_ the module transformer.
import { useFancyState } from './hooks';
export default function App() {
    _b();
    const bar = useFancyState();
    return <h1>{bar}</h1>;
}
_a = App;
$RefreshReg$(_a, "App");
_b(App, "useFancyState{bar}", false, () => [useFancyState]);
