import React, { useState } from 'https://esm.sh/react'

export default function Logo({ width = 75 }: { width?: number }) {
   const [height, setHeight] =  useState(width)


    return (
        <img src="/logo.svg" width={width} height={height} title="Aleph.js" />
    )
}
