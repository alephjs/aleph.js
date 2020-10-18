import { Head, Link } from 'https://deno.land/x/aleph/mod.ts'
import React from 'https://esm.sh/react'

export default function Blog() {
    return (
        <>
            <Head>
                <title>My Blog.</title>
            </Head>
            <h1>My Blog.</h1>
            <ul>
                <li><Link to="/post/hello-world">Hello World</Link></li>
                <li><Link to="/post/bla-bla-bla">Bla Bla Bla</Link></li>
            </ul>
            <p><Link to="/">Home</Link></p>
        </>
    )
}
