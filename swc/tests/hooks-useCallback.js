// ? should generate signature for built-in hooks
export function CallbackTest() {
    const x = useCallback(() => {})
    const [p] = [useCallback(a, [a, b])]
}
