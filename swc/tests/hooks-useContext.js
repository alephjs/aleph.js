// ? should generate signature for built-in hooks
export function ContextTest() {
    const ctx = useContext(expr)
    const { val } = useContext(expr2, extra)
    useContext(expr3)
}
