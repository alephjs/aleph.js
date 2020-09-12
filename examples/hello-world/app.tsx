import React, { Fragment, PropsWithChildren } from 'https://esm.sh/react'
import { Head } from 'https://alephjs.org/mod.ts'

export default function App({ children }: PropsWithChildren<{}>) {
    return (
        <Fragment>
            <Head>
                <title>Welcome - AlephJS</title>
            </Head>
            {children}
        </Fragment>
    )
}
