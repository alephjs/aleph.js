import type { PropsWithChildren, ScriptHTMLAttributes } from 'https://esm.sh/react'
import { useContext } from 'https://esm.sh/react'
import util from '../../shared/util.ts'
import { RendererContext } from './context.ts'

export default function Script(props: PropsWithChildren<ScriptHTMLAttributes<{}>>) {
  const renderer = useContext(RendererContext)

  if (util.inDeno()) {
    const key = 'script-' + (renderer.scriptsElements.size + 1)
    renderer.scriptsElements.set(key, { type: 'script', props })
  }

  // todo: insert page scripts in browser

  return null
}
