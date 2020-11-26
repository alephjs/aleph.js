import React from 'react'
// @ts-expect-error
import wasm from './42.wasm'
// @ts-expect-error
import './style.sass'

export default function Home() {
    return (
        <h1>{wasm.main()}</h1>
    )
}
