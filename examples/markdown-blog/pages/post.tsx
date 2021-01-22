import React, { ComponentType } from 'react'

interface Metadata {
    title: string
    author: string
    date: string
}

export default function Blog({ Page }: { Page: ComponentType & { meta: Metadata } }) {
    return (
        <>
            <head>
                <title>{Page.meta.title}</title>
            </head>
            <Page />
            <p style={{ color: '#666' }}>created by <em style={{ color: '#000' }}>{Page.meta.author}</em> at <em style={{ color: '#000' }}>{Page.meta.date}</em></p>
            <p><a href="/blog">My Blog</a></p>
        </>
    )
}
