// ? should generate signature for built-in hooks
export function EffectTest() {
    const rtn = useEffect()
    useEffect(expr, [deps])
    useEffect(() => {
        do_some()
    })
    useEffect(() => (sideEffect(), () => undo()))
}
