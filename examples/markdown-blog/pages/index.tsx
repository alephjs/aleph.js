import { Head, Link } from 'https://deno.land/x/aleph/mod.ts'
import React from 'https://esm.sh/react'

export default function Home() {
    return (
        <div className="wrapper">
             <Head>
                <title>My Blog.</title>
            </Head>
            <h1>My Blog.</h1>
            <ul>
                <li><Link to="/blog">Hello World</Link></li>
                <li><Link to="/blog/readme">Aleph.js</Link></li>
            </ul>
        </div>
    )
}
