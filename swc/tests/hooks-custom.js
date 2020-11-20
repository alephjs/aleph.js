// ? includes custom hooks into the signatures

function useFancyState() {
    const [foo, setFoo] = React.useState(0)
    useFancyEffect()
    return foo
}
const useFancyEffect = () => {
    React.useEffect(() => {})
}
export default function App() {
    const bar = useFancyState()
    return <h1>{bar}</h1>
}
