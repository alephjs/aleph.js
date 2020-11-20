// ? should track custom hooks

function App() {
    function useLocal() {
        return useState(0)
    }
    const useLocal2 = () => useLocal()
    useLocal(useLocal2())
}
// hooks in App should not be trackable and force refresh (3rd param be true)
