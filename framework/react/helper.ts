import { createContext } from 'https://esm.sh/react@17.0.2'

const symbolFor = typeof Symbol === 'function' && typeof Symbol.for === 'function'
const REACT_FORWARD_REF_TYPE = symbolFor ? Symbol.for('react.forward_ref') : 0xead0
const REACT_MEMO_TYPE = symbolFor ? Symbol.for('react.memo') : 0xead3

export const inDeno = typeof Deno !== 'undefined' && typeof Deno.version?.deno === 'string'

export function isLikelyReactComponent(type: any, strict = true): Boolean {
  switch (typeof type) {
    case 'function':
      return true
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
