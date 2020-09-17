import React from 'https://esm.sh/react'

export default function Logo({ height = 90 }: { height?: number }) {
    return (
        <img src="/logo.png" height={height} title="Aleph.js" />
    )
}
