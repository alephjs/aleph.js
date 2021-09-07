import React from 'react'
import { AppProps } from 'aleph/types.d.ts'

export default function App({ Page, pageProps }: AppProps) {
  return (
    <main>
      <head>
        <meta name="viewport" content="width=device-width" />
      </head>
      <Page {...pageProps} />
    </main>
  )
}
