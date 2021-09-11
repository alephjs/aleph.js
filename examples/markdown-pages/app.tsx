import React, { FC } from 'react'
import './style/index.css'

type Metadata = {
  title?: string
}

export default function App({ Page, pageProps }: { Page: FC & { meta: Metadata }, pageProps: any }) {
  return (
    <main>
      <head>
        <title>{Page.meta.title}</title>
      </head>
      <Page {...pageProps} />
    </main>
  )
}
