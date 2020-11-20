var _a;
// ? ignores higher-order functions that are not HOCs
const throttledAlert = throttle(_a = function () {
    alert('Hi');
});
$RefreshReg$(_a, "throttledAlert$throttle");
const TooComplex = (function () {
    return hello;
})(() => { });
if (cond) {
    const Foo = thing(() => { });
}
