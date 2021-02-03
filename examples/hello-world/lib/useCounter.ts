import { useCallback, useEffect, useState } from 'react'

export default function useCounter(): [number, boolean, () => void, () => void] {
    const [isSyncing, setIsSyncing] = useState(true)
    const [count, setCount] = useState(0)
    const increase = useCallback(() => {
        setCount(n => n + 1)
        fetch('/api/counter/increase').catch(e => console.error(e))
    }, [])
    const decrease = useCallback(() => {
        setCount(n => n - 1)
        fetch('/api/counter/decrease').catch(e => console.error(e))
    }, [])

    useEffect(() => {
        fetch('/api/counter').then(resp => resp.json().catch(() => ({ count: 0 })))
            .then(({ count }) => {
                if (typeof count === 'number') {
                    setCount(count)
                }
            })
            .catch(e => console.error(e))
            .finally(() => {
                setIsSyncing(false)
            })
    }, [])

    return [count, isSyncing, increase, decrease]
}
