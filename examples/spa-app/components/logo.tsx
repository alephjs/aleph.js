import React from 'react'

export default function Logo({ width = 75 }: { width?: number }) {
    return (
        <img src="/logo.svg" width={width} title="Aleph.js" />
    )
}
