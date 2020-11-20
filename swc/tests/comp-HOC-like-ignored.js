// ? ignores higher-order functions that are not HOCs

const throttledAlert = throttle(function () {
    alert('Hi')
})
const TooComplex = (function () {
    return hello
})(() => {})
if (cond) {
    const Foo = thing(() => {})
}
