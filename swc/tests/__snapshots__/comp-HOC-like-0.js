var _a, _b, _c, _d, _e, _f, _g, _h;
// ? registers likely HOCs with inline functions
const A = forwardRef(_a = function () {
    return <h1>Foo</h1>;
});
$RefreshReg$(_a, "A$forwardRef");
_b = A;
$RefreshReg$(_b, "A");
const B = memo(_c = React.forwardRef(_d = () => {
    return <h1>Foo</h1>;
}));
$RefreshReg$(_d, "B$memo$React.forwardRef");
$RefreshReg$(_c, "B$memo");
_e = B;
$RefreshReg$(_e, "B");
export default _h = React.memo(_f = forwardRef(_g = (props, ref) => {
    return <h1>Foo</h1>;
}));
$RefreshReg$(_h, "%default%");
$RefreshReg$(_g, "%default%$React.memo$forwardRef");
$RefreshReg$(_f, "%default%$React.memo");
