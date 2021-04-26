import { createContext } from 'https://esm.sh/react@17.0.2'

const symbolFor = typeof Symbol === 'function' && typeof Symbol.for === 'function'
const REACT_FORWARD_REF_TYPE = symbolFor ? Symbol.for('react.forward_ref') : 0xead0
const REACT_MEMO_TYPE = symbolFor ? Symbol.for('react.memo') : 0xead3

export const inDeno = typeof Deno !== 'undefined' && typeof Deno.version?.deno === 'string'

export function isLikelyReactComponent(type: any, strict = true): Boolean {
  switch (typeof type) {
    case 'function':
      if (type.prototype != null) {
        if (type.prototype.isReactComponent) {
          return true
        }
        const ownNames = Object.getOwnPropertyNames(type.prototype)
        if (ownNames.length > 1 || ownNames[0] !== 'constructor') {
          return false
        }
      }
      if (!strict) {
        // don't check component name
        return true
      }
      const { __ALEPH: ALEPH } = window as any
      if (ALEPH) {
        // in bundle mode, the component names have been compressed.
        return true
      }
      const name = type.displayName || type.name
      return typeof name === 'string' && /^[A-Z]/.test(name)
    case 'object':
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
    default:
      return false
  }
}

export function createNamedContext<T>(defaultValue: T, name: string) {
  const ctx = createContext<T>(defaultValue)
  ctx.displayName = name // show in devTools
  return ctx
}
