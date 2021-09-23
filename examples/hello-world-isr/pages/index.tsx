import type { SSROptions } from 'aleph/types.d.ts'
import React, { FC } from 'react'

type Props = {
  serverTime: number
  ua: string | null
}

export const ssr: SSROptions<Props> = {
  props: req => ({
    $revalidate: 1, // revalidate props after 1 second
    serverTime: Date.now(),
    ua: req.headers.get('User-Agent'),
  })
}

const Page: FC<Props> = (props) => {
  return (
    <>
      <p>Now: {props.serverTime}</p>
      <p>UA: {props.ua}</p>
    </>
  )
}

export default Page
