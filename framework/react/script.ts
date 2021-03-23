import {
  PropsWithChildren,
  ScriptHTMLAttributes,
  useContext
} from 'https://esm.sh/react'
import util from '../../shared/util.ts'
import { SSRContext } from './context.ts'

export default function Script(props: PropsWithChildren<ScriptHTMLAttributes<{}>>) {
  const { scriptElements } = useContext(SSRContext)

  if (util.inDeno()) {
    const key = 'script-' + (scriptElements.size + 1)
    scriptElements.set(key, { props })
  }

  // todo: insert page scripts in browser

  return null
}
