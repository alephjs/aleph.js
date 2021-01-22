import React from 'react'
// @ts-expect-error
import wasm from './42.wasm'

export default function Home() {
    return (
        <>
            <link rel="stylesheet" href="./style.scss" />
            <h1>{wasm.main()}</h1>
        </>
    )
}
