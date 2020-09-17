import { createContext, useContext } from 'https://esm.sh/react'

export const DataContext = createContext<{ data: Record<string, any> }>({
    data: {},
})
DataContext.displayName = 'DataContext'

export function useData(key: string) {
    const { data } = useContext(DataContext)
    return data[key]
}
