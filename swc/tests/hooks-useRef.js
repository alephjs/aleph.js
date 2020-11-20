// ? should generate signature for built-in hooks
export function RefTest() {
    const ref = useRef()
    const ref2 = useRef(complex.expr(1), extra)
    const { current } = React.useRef()
}
