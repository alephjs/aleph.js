// ? uses original function declaration if it get reassigned

function Hello() {
    return <h1>Hi</h1>
}
Hello = connect(Hello)
