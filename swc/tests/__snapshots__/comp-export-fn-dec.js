var _a, _b, _c;
// ? registers top-level exported function declarations
export function Hello() {
    function handleClick() { }
    return <h1 onClick={handleClick}>Hi</h1>;
}
_a = Hello;
$RefreshReg$(_a, "Hello");
export default function Bar() {
    return <Hello />;
}
_b = Bar;
$RefreshReg$(_b, "Bar");
function Baz() {
    return <h1>OK</h1>;
}
_c = Baz;
$RefreshReg$(_c, "Baz");
const NotAComp = 'hi';
export { Baz, NotAComp };
export function sum() { }
export const Bad = 42;
