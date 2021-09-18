import React, { FC } from 'react'

export default function App({ Page, pageProps }: { Page: FC, pageProps: any }) {
  return (
    <main>
      <head>
        <meta name="viewport" content="width=device-width" />
      </head>
      <Page {...pageProps} />
    </main>
  )
}
