// ? should generate signature for custom hooks
function A() {
    const [x] = useCustom(1, 2, 3)
    useCustom()
}
