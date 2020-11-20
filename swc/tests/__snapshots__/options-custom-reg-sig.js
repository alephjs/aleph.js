var _a;
var _b;
_b = $RefreshSig$();
// ? uses custom identifiers for $RefreshReg$ and $RefreshSig$
export default function Bar() {
    _b();
    useContext(X);
    return <Foo />;
}
_a = Bar;
$RefreshReg$(_a, "Bar");
_b(Bar, "useContext{}");
