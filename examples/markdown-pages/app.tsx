import React, { ComponentType } from 'react'
import { AppProps } from 'aleph/types.d.ts'


type Metadata = {
  title?: string
  url?: string
}

export default function App({ Page, pageProps }: AppProps<Record<string, any>, { meta: Metadata }>) {
  return (
    <main>
      <head>
        <title>{Page.meta.title}</title>
        <link rel="stylesheet" href="./style/index.css" />
      </head>
      <Page {...pageProps} />
    </main>
  )
}
