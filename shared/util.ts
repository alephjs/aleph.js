export default {
  inDeno: typeof Deno !== 'undefined' && typeof Deno.version?.deno === 'string',
  supportSymbolFor: typeof Symbol === 'function' && typeof Symbol.for === 'function',
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
    return typeof a === 'object' && a !== null && !Array.isArray(a) && Object.getPrototypeOf(a) == Object.prototype
  },
  isFunction(a: any): a is Function {
    return typeof a === 'function'
  },
  isLikelyHttpURL(s: string): boolean {
    const p = s.slice(0, 8).toLowerCase()
    return p === 'https://' || p.slice(0, 7) === 'http://'
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
  splitBy(s: string, searchString: string): [string, string] {
    const i = s.indexOf(searchString)
    if (i >= 0) {
      return [s.slice(0, i), s.slice(i + 1)]
    }
    return [s, '']
  },
  formatBytes(bytes: number) {
    if (bytes < 1024) {
      return bytes.toString() + 'B'
    }
    if (bytes < 1024 ** 2) {
      return Math.ceil(bytes / 1024) + 'KB'
    }
    if (bytes < 1024 ** 3) {
      return Math.ceil(bytes / 1024 ** 2) + 'MB'
    }
    if (bytes < 1024 ** 4) {
      return Math.ceil(bytes / 1024 ** 3) + 'GB'
    }
    if (bytes < 1024 ** 5) {
      return Math.ceil(bytes / 1024 ** 4) + 'TB'
    }
    return Math.ceil(bytes / 1024 ** 5) + 'PB'
  },
  splitPath(path: string): string[] {
    return path
      .split(/[\/\\]+/g)
      .map(p => p.trim())
      .filter(p => p !== '' && p !== '.')
      .reduce((slice, p) => {
        if (p === '..') {
          slice.pop()
        } else {
          slice.push(p)
        }
        return slice
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
