import { Head } from 'https://deno.land/x/aleph/mod.ts'
import React, { ComponentType } from 'https://esm.sh/react'

interface Metadata {
    title: string
    author: string
    date: string
}

export default function Blog({ Page }: { Page: ComponentType & { meta: Metadata } }) {
    return (
        <>
            <Head>
                <title>{Page.meta.title}</title>
            </Head>
            <h1>{Page.meta.title}</h1>
            <p style={{ color: 'gray', border: '1px solid #ddd', padding: 12, borderRadius: 6 }}>
                <small>
                    <em>{Page.meta.author}, {Page.meta.date}</em>
                </small>
            </p>
            <Page />
        </>
    )
}
