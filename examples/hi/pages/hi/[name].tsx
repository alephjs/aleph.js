import { Import, useDeno, Link, useRouter } from 'https://deno.land/x/aleph/mod.ts'
import React from 'https://esm.sh/react'
import Logo from '../../components/logo.tsx'

export default function Home() {
    const { params } = useRouter()
    const version = useDeno(() => {
        return Deno.version
    })

    return (
        <div className="page">
            <Import from="../../style/index.less" />
            <p className="logo"><Logo /></p>
            <h1>Hi, <strong>{params.name}</strong>!</h1>
            <p className="go-button">
                <Link to="/"><button>Back</button></Link>
            </p>
            <p className="links">
                <a href="https://alephjs.org" target="_blank">Website</a>
                <span>&middot;</span>
                <a href="https://alephjs.org/docs/get-started" target="_blank">Get Started</a>
                <span>&middot;</span>
                <a href="https://alephjs.org/docs" target="_blank">Docs</a>
                <span>&middot;</span>
                <a href="https://github.com/alephjs/alephjs" target="_blank">Github</a>
            </p>
            <p className="copyinfo">Built by Aleph.js in Deno v{version.deno}</p>
        </div>
    )
}
