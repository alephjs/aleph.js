import { Head, Link } from 'https://deno.land/x/aleph/mod.ts'
import React from 'https://esm.sh/react'

export default function About() {
    return (
        <>
            <Head>
                <title>About Me.</title>
            </Head>
            <h1>About Me.</h1>
            <p><strong>Me</strong>, a <em>full-stack</em> web developor.</p>
            <p><Link to="/">Home</Link></p>
        </>
    )
}
