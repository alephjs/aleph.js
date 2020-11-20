// ? should track custom hooks

function useLocal() {
    return useState(0)
}
const useLocal2 = () => useLocal()
function App() {
    useLocal(useLocal2())
}
