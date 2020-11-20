var _a, _b, _c;
var _d, _e;
_d = $RefreshSig$();
_e = $RefreshSig$();
// ? should generate signature for built-in hooks
function ImperativeHandle(props, ref) {
    _d();
    const v = useImperativeHandle(ref, () => ({ a }));
}
_a = ImperativeHandle;
$RefreshReg$(_a, "ImperativeHandle");
_d(ImperativeHandle, "useImperativeHandle{v}");
ImperativeHandle = forwardRef(ImperativeHandle);
const HOC = forwardRef(_b = _e(function (props, ref) {
    _e();
    const v = useImperativeHandle(ref, () => ({ a }));
}, "useImperativeHandle{v}"));
$RefreshReg$(_b, "HOC$forwardRef");
_c = HOC;
$RefreshReg$(_c, "HOC");
