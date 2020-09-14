import React from 'https://esm.sh/react'

export default function Logo({ height = 66 }: { height?: number }) {
    return (
        <img src="/logo.png" height={height} title="AlephJS" />
    )
}
