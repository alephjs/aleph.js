import type { ComponentType } from 'react'
import React from 'react'

export default function App({ Page, pageProps }: { Page: ComponentType<any>, pageProps: any }) {
    return (
        <main>
            <link rel="stylesheet" href="./style/app.css" />
            <Page {...pageProps} />
        </main>
    )
}
