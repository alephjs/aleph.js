var _a, _b, _c, _d;
// ? registers capitalized identifiers in HOC calls
function Foo() {
    return <h1>Hi</h1>;
}
_a = Foo;
$RefreshReg$(_a, "Foo");
export default _b = hoc(Foo);
$RefreshReg$(_b, "%default%");
export const A = hoc(Foo);
_c = A;
$RefreshReg$(_c, "A");
const B = hoc(Foo);
_d = B;
$RefreshReg$(_d, "B");
