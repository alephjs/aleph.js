import React, { useState } from 'https://esm.sh/react'
import Logo from '../components/logo.tsx'
import '../style/index.less'

export async function getStaticProps() {
    return { name: 'AlephJS' }
}

export default function Home({ name }: { name: string }) {
    const [count, setCount] = useState(0)

    return (
        <div className="wrapper">
            <p><Logo /></p>
            <p>Welcome to use <strong>{name}</strong>!</p>
            <p className="links">
                <span>[</span>
                <a href="https://alephjs.org/docs" target="_blank">Docs</a>
                <span>|</span>
                <a href="https://github.com/postui/postjs" target="_blank">Github</a>
                <span>]</span>
            </p>
            <p className="counter">
                <span>Counter:</span>
                <strong>{count}</strong>
                <button onClick={() => setCount(n => n-1)}>-</button>
                <button onClick={() => setCount(n => n+1)}>+</button>
            </p>
        </div>
    )
}
