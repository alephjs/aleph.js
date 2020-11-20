var _a, _b, _c;
// ? registers top-level variable declarations with arrow functions
let Hello = () => {
    const handleClick = () => { };
    return <h1 onClick={handleClick}>Hi</h1>;
};
_a = Hello;
$RefreshReg$(_a, "Hello");
const Bar = () => {
    return <Hello />;
};
_b = Bar;
$RefreshReg$(_b, "Bar");
var Baz = () => <div />;
_c = Baz;
$RefreshReg$(_c, "Baz");
var sum = () => { };
