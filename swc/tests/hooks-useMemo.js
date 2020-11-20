// ? should generate signature for built-in hooks
export function MemoTest() {
    const x = useMemo(() => {})
    const [p] = [useMemo(a, [a, b])]
}
