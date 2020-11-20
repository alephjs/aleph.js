// ? should generate signature for built-in hooks

export function StateTest() {
    const a = useState(0, extra)
    const [b] = useState(complex + expression.f())
    const [c, d] = React.useState()
    const [[e], f] = useState([0])
    const { 0: y, 1: z, length } = useState(() => {
        a()
        multiple()
        line()
        expression()
    })
}
