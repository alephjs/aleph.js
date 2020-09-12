import React from 'https://esm.sh/react'

export default function Logo({ height = 60 }: { height?: number }) {
    return (
        <img src="/logo.png" height={height} title="AlephJS" />
    )
}
