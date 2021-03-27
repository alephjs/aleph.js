import React, { ComponentType } from 'react'

type Metadata = {
  title?: string
  url?: string
}

export default function App({ Page, pageProps }: { Page: ComponentType<any> & { meta: Metadata }, pageProps: any }) {
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
