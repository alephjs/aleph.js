import React, { ComponentType } from 'https://esm.sh/react'
import { Head } from 'https://deno.land/x/aleph/mod.ts'

export default function App({ Page, pageProps }: { Page: ComponentType<any>, pageProps: any }) {
    return (
        <>
            <Head>
                <title>Hello World - Aleph.js</title>
            </Head>
            <Page {...pageProps} />
        </>
    )
}
