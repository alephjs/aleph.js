import { GB, KB, MB, PB, TB } from './constants.ts'

export default {
    isNumber(a: any): a is number {
        return typeof a === 'number' && !Number.isNaN(a)
    },
    isUNumber(a: any): a is number {
        return this.isNumber(a) && a >= 0
    },
    isInt(a: any): a is number {
        return this.isNumber(a) && Number.isInteger(a)
    },
    isUInt(a: any): a is number {
        return this.isInt(a) && a >= 0
    },
    isString(a: any): a is string {
        return typeof a === 'string'
    },
    isNEString(a: any): a is string {
        return typeof a === 'string' && a.length > 0
    },
    isArray(a: any): a is Array<any> {
        return Array.isArray(a)
    },
    isNEArray(a: any): a is Array<any> {
        return Array.isArray(a) && a.length > 0
    },
    isPlainObject(a: any): a is Record<string, any> {
        return typeof a === 'object' && a !== null && !this.isArray(a) && Object.getPrototypeOf(a) == Object.prototype
    },
    isFunction(a: any): a is Function {
        return typeof a === 'function'
    },
    trimPrefix(s: string, prefix: string): string {
        if (prefix !== '' && s.startsWith(prefix)) {
            return s.slice(prefix.length)
        }
        return s
    },
    trimSuffix(s: string, suffix: string): string {
        if (suffix !== '' && s.endsWith(suffix)) {
            return s.slice(0, -suffix.length)
        }
        return s
    },
    ensureExt(s: string, ext: string): string {
        if (s.endsWith(ext)) {
            return s
        }
        return s + ext
    },
    splitBy(s: string, searchString: string): [string, string] {
        const i = s.indexOf(searchString)
        if (i >= 0) {
            return [s.slice(0, i), s.slice(i + 1)]
        }
        return [s, '']
    },
    bytesString(bytes: number) {
        if (bytes < KB) {
            return bytes.toString() + 'B'
        }
        if (bytes < MB) {
            return Math.ceil(bytes / KB) + 'KB'
        }
        if (bytes < GB) {
            return this.trimSuffix((bytes / MB).toFixed(1), '.0') + 'MB'
        }
        if (bytes < TB) {
            return this.trimSuffix((bytes / GB).toFixed(1), '.0') + 'GB'
        }
        if (bytes < PB) {
            return this.trimSuffix((bytes / TB).toFixed(1), '.0') + 'TB'
        }
        return this.trimSuffix((bytes / PB).toFixed(1), '.0') + 'PB'
    },
    splitPath(path: string): string[] {
        return path
            .split(/[\/\\]+/g)
            .map(p => p.trim())
            .filter(p => p !== '' && p !== '.')
            .reduce((path, p) => {
                if (p === '..') {
                    path.pop()
                } else {
                    path.push(p)
                }
                return path
            }, [] as Array<string>)
    },
    cleanPath(path: string): string {
        return '/' + this.splitPath(path).join('/')
    },
    debounce<T extends Function>(callback: T, delay: number): T {
        let timer: number | null = null
        return ((...args: any[]) => {
            if (timer != null) {
                clearTimeout(timer)
            }
            timer = setTimeout(() => {
                timer = null
                callback(...args)
            }, delay)
        }) as any
    },
    debounceX(id: string, callback: () => void, delay: number) {
        const self = this as any
        const timers: Map<string, number> = self.__debounce_timers || (self.__debounce_timers = new Map())
        if (timers.has(id)) {
            clearTimeout(timers.get(id)!)
        }
        timers.set(id, setTimeout(() => {
            timers.delete(id)
            callback()
        }, delay))
    }
}
