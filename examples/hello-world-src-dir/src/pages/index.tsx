import { useDeno } from 'aleph/react.ts'
import React from 'react'
import Logo from '../components/logo.tsx'
import useCounter from '../lib/useCounter.ts'

export default function Home() {
  const [count, isSyncing, increase, decrease] = useCounter()
  const version = useDeno(() => Deno.version.deno)

  return (
    <div className="page">
      <head>
        <title>Hello World - Aleph.js</title>
        <link rel="stylesheet" href="../style/index.css" />
      </head>
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
        {isSyncing && (
          <em>...</em>
        )}
        {!isSyncing && (
          <strong>{count}</strong>
        )}
        <button onClick={decrease}>-</button>
        <button onClick={increase}>+</button>
      </div>
      <p className="copyinfo">Built by Aleph.js in Deno {version}</p>
    </div>
  )
}
