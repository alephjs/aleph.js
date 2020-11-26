import React, { ComponentType } from 'react'

export default function App({ Page, pageProps }: { Page: ComponentType<any>, pageProps: any }) {
    return (
        <>
            <head>
                <title>Hello World - Aleph.js</title>
            </head>
            <Page {...pageProps} />
        </>
    )
}
