import React from 'react'
// @ts-expect-error
import wasm from '../lib/42.wasm'

const fontSize = 240

export default function Home() {
  return (
    <main>
      <style>{`
        body {
          display: flex;
          justify-content: center;
          align-items: center;
          width: 100vw;
          height: 100vh;
          overflow: hidden;
        }

        h1 {
          font-size: ${fontSize}px;
        }
      `}</style>
      <h1>{wasm.main()}</h1>
    </main>
  )
}
