// ? should generate signature for built-in hooks
function ImperativeHandle(props, ref) {
    const v = useImperativeHandle(ref, () => ({ a }))
}
ImperativeHandle = forwardRef(ImperativeHandle)
const HOC = forwardRef(function (props, ref) {
    const v = useImperativeHandle(ref, () => ({ a }))
})
