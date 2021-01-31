import React, { useState } from 'react'
import Logo from '../components/logo.tsx'

export default function Home() {
    const [count, setCount] = useState(0)

    return (
        <div className="page">
            <link rel="stylesheet" href="../style/index.css" />
            <p className="logo"><Logo /></p>
            <h1>Welcome to use <strong>Aleph.js</strong>!</h1>
            <p className="links">
                <a href="https://alephjs.org" target="_blank">Website</a>
                <span></span>
                <a href="https://alephjs.org/docs/get-started" target="_blank">Get Started</a>
                <span></span>
                <a href="https://alephjs.org/docs" target="_blank">Docs</a>
                <span></span>
                <a href="https://github.com/alephjs/aleph.js" target="_blank">Github</a>
            </p>
            <div className="counter">
                <span>Counter:</span>
                <strong>{count}</strong>
                <button onClick={() => setCount(n => n - 1)}>-</button>
                <button onClick={() => setCount(n => n + 1)}>+</button>
            </div>
            <p className="copyinfo">Built by Aleph.js</p>
        </div>
    )
}
