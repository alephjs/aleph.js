import React, { Fragment, PropsWithChildren } from 'https://esm.sh/react'
import { Head } from 'https://deno.land/x/aleph/mod.ts'

export default function App({ children }: PropsWithChildren<{}>) {
    return (
        <Fragment>
            <Head>
                <title>Hello World - AlephJS</title>
            </Head>
            {children}
        </Fragment>
    )
}
