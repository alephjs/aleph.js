import { Import, Link } from 'https://deno.land/x/aleph/mod.ts'
import React from 'https://esm.sh/react'

export default function Home() {
    return (
        <div className="wrapper">
            <h1>My Blog.</h1>
            <ul>
                <li><Link to="/blog/hello-world">Hello World</Link></li>
            </ul>
        </div>
    )
}
