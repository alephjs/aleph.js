import React, { useMemo } from 'https://esm.sh/react'
import { useData } from 'https://deno.land/x/aleph/mod.ts'

export default function Home() {
    const time = useData('time')
    const iso = useMemo(() => {
        const d = new Date()
        d.setTime(time)
        return d.toISOString().split('.')[0].replace(/T/, ' ')
    }, [time])

    return (
        <p>server time → <strong>{iso}</strong></p>
    )
}
