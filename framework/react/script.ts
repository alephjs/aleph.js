import {
  PropsWithChildren,
  ScriptHTMLAttributes,
  useContext
} from 'react'
import util from '../../shared/util.ts'
import { SSRContext } from './context.ts'

export default function Script(props: PropsWithChildren<ScriptHTMLAttributes<{}>>) {
  const { scripts } = useContext(SSRContext)

  if (util.inDeno) {
    const key = 'script-' + (scripts.size + 1)
    scripts.set(key, { props })
  }

  // todo: insert page scripts in browser

  return null
}
