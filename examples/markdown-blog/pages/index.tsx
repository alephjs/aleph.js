import { Head, Link } from 'https://deno.land/x/aleph/mod.ts'
import React from 'https://esm.sh/react'

export default function Home() {
    return (
        <>
            <Head>
                <title>Me.</title>
            </Head>
            <h1>Me.</h1>
            <ul>
                <li><Link to="/about">About Me</Link></li>
                <li><Link to="/blog">My Blog</Link></li>
            </ul>
        </>
    )
}
