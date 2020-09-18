import { createContext, useContext } from 'https://esm.sh/react'

export const DataContext = createContext<Record<string, any>>({})
DataContext.displayName = 'DataContext'

export function useData(key: string) {
    const data = useContext(DataContext)
    return data[key]
}
