import React, { FC } from 'https://esm.sh/react'
import type { SSROptions } from 'https://deno.land/x/aleph/types.d.ts'

type Props = {
  serverTime: number
}

export const ssr: SSROptions<Props> = {
  props: async router => {
    return {
      $revalidate: 1, // revalidate props after 1 second
      serverTime: Date.now()
    }
  },
  paths: async () => {
    return []
  }
}

const Page: FC<Props> = (props) => {
  return (
    <p>Now: {props.serverTime}</p>
  )
}

export default Page
