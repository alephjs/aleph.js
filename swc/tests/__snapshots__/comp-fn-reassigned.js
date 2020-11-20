var _a;
// ? uses original function declaration if it get reassigned
function Hello() {
    return <h1>Hi</h1>;
}
_a = Hello;
$RefreshReg$(_a, "Hello");
Hello = connect(Hello);
