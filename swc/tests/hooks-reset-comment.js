// ? should recognize reset comment

// @refresh reset
function App() {
    useState(0)
}
// Should not be reset?
function Not() {
    useState(0)
}
