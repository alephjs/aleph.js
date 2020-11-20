// ? should generate signature for built-in hooks
export function ReducerTest() {
    const [state, dispatch] = useReducer(reducer, initArg, init, extra)
    useReducer()
}
