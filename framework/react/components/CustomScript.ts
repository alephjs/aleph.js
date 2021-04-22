import {
  PropsWithChildren,
  ScriptHTMLAttributes,
  useContext
} from 'react'
import { SSRContext } from '../context.ts'
import { inDeno } from '../helper.ts'

export default function CustomScript(props: PropsWithChildren<ScriptHTMLAttributes<{}>>) {
  const { scripts } = useContext(SSRContext)

  if (inDeno) {
    const key = 'script-' + (scripts.size + 1)
    scripts.set(key, { props })
  }

  // todo: insert page scripts in browser

  return null
}
