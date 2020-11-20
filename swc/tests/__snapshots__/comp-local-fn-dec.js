var _a, _b;
// ? registers top-level function declarations
function Hello() {
    function handleClick() { }
    return <h1 onClick={handleClick}>Hi</h1>;
}
_a = Hello;
$RefreshReg$(_a, "Hello");
function Bar() {
    return <Hello />;
}
_b = Bar;
$RefreshReg$(_b, "Bar");
