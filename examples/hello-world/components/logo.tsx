import React from 'https://esm.sh/react'

export default function Logo({ height = 80 }: { height?: number }) {
    return (
        <img src="/logo.png" height={height} title="AlephJS" />
    )
}
