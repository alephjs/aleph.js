// ? does not consider require-like methods to be HOCs

const A = require('A')
const B = foo ? require('X') : require('Y')
const C = requireCond(gk, 'C')
const D = import('D')
export default function App() {
    return (
        <div>
            <A />
            <B />
            <C />
            <D />
        </div>
    )
}
