import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'aleph/react'

export function useLocaleText(...texts: string[]): string {
  const { locale, locales } = useRouter()
  return texts[locales.indexOf(locale)]
}

export function useCounter(): [number, boolean, () => void, () => void] {
  const [count, setCount] = useState(0)
  const [isSyncing, setIsSyncing] = useState(true)
  const increase = useCallback(() => {
    setCount(n => n + 1)
    fetch('/api/counter/increase').catch(e => console.error(e))
  }, [])
  const decrease = useCallback(() => {
    setCount(n => n - 1)
    fetch('/api/counter/decrease').catch(e => console.error(e))
  }, [])

  useEffect(() => {
    fetch('/api/counter').then(resp => resp.json().catch(() => ({})))
      .then(({ count }) => {
        if (typeof count === 'number' && !Number.isNaN(count)) {
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
