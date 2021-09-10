import React from 'https://esm.sh/react'
import type { SSROptions } from 'https://deno.land/x/aleph/types.d.ts'

export const ssr: SSROptions = {
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

export default function Page(props) {
  return (
    <p>Now: {props.serverTime}</p>
  )
}
