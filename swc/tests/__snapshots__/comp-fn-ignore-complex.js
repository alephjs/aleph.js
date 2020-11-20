var _a;
// ? ignores complex definitions
let A = foo
    ? () => {
        return <h1>Hi</h1>;
    }
    : null;
const B = (function Foo() {
    return <h1>Hi</h1>;
})();
let C = () => () => {
    return <h1>Hi</h1>;
};
_a = C;
$RefreshReg$(_a, "C");
let D = bar &&
    (() => {
        return <h1>Hi</h1>;
    });
