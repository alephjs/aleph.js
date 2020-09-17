export const hashShort = 7

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
    isArray<T = any>(a: any): a is Array<T> {
        return Array.isArray(a)
    },
    isNEArray<T = any>(a: any): a is Array<T> {
        return Array.isArray(a) && a.length > 0
    },
    isPlainObject(a: any): a is Record<string, any> {
        return typeof a === 'object' && a !== null && !this.isArray(a) && Object.getPrototypeOf(a) == Object.prototype
    },
    isFunction(a: any): a is Function {
        return typeof a === 'function'
    },
    isLikelyReactComponent: (() => {
        /**
         * Copyright (c) Facebook, Inc. and its affiliates.
         *
         * This source code is licensed under the MIT license found in the
         * LICENSE file in the root directory of this source tree.
         *
         */

        const symbolFor = typeof Symbol === 'function' && Symbol.for
        const REACT_FORWARD_REF_TYPE = symbolFor ? Symbol.for('react.forward_ref') : 0xead0
        const REACT_MEMO_TYPE = symbolFor ? Symbol.for('react.memo') : 0xead3

        function isLikelyComponentType(type: any): boolean {
            switch (typeof type) {
                case 'function': {
                    if (type.prototype != null) {
                        if (type.prototype.isReactComponent) {
                            return true
                        }
                        const ownNames = Object.getOwnPropertyNames(type.prototype);
                        if (ownNames.length > 1 || ownNames[0] !== 'constructor') {
                            return false
                        }
                    }
                    const name = type.name || type.displayName
                    return typeof name === 'string' && /^[A-Z]/.test(name)
                }
                case 'object': {
                    if (type != null) {
                        switch (type.$$typeof) {
                            case REACT_FORWARD_REF_TYPE:
                            case REACT_MEMO_TYPE:
                                return true
                            default:
                                return false
                        }
                    }
                    return false
                }
                default: {
                    return false
                }
            }
        }

        return isLikelyComponentType
    })(),
    isHttpUrl(url: string) {
        return url.startsWith('https://') || url.startsWith('http://')
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
    splitBy(s: string, splitter: string): [string, string] {
        const i = s.indexOf(splitter)
        if (i >= 0) {
            return [s.slice(0, i), s.slice(i + 1)]
        }
        return [s, '']
    },
    splitPath(path: string): string[] {
        return path
            .split('/')
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
    debounce(callback: () => void, delay: number) {
        let timer: number | null = null
        return () => {
            if (timer != null) {
                clearTimeout(timer)
            }
            timer = setTimeout(() => {
                timer = null
                callback()
            }, delay)
        }
    }
}
