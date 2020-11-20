var _a, _b;
// ? registers top-level variable declarations with function expressions
let Hello = function () {
    function handleClick() { }
    return <h1 onClick={handleClick}>Hi</h1>;
};
_a = Hello;
$RefreshReg$(_a, "Hello");
const Bar = function Baz() {
    return <Hello />;
};
_b = Bar;
$RefreshReg$(_b, "Bar");
function sum() { }
let Baz = 10;
var Qux;
