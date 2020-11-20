// ? registers likely HOCs with inline functions

export default React.memo(
    forwardRef(function (props, ref) {
        return <h1>Foo</h1>
    })
)
