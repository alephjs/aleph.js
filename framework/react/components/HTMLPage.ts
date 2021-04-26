/// <reference lib="dom" />

import React, { useEffect, useRef, RefObject, PropsWithRef, HTMLAttributes } from 'https://esm.sh/react@17.0.2'
import { redirect } from '../../core/redirect.ts'

type HTMLPageProps = PropsWithRef<HTMLAttributes<{}> & {
  ref?: RefObject<HTMLDivElement>
  html: string
}>

export default function HTMLPage({
  ref: pRef,
  html,
  children,
  dangerouslySetInnerHTML,
  ...rest
}: HTMLPageProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const REF = pRef || ref
    const anchors: HTMLAnchorElement[] = []
    const onClick = (e: MouseEvent) => {
      e.preventDefault()
      if (e.currentTarget) {
        redirect((e.currentTarget as HTMLAnchorElement).getAttribute('href')!)
      }
    }

    if (REF.current) {
      REF.current.querySelectorAll('a').forEach((a: HTMLAnchorElement) => {
        const href = a.getAttribute('href')
        if (href && !/^[a-z0-9]+:/i.test(href)) {
          a.addEventListener('click', onClick, false)
          anchors.push(a)
        }
      })
    }

    return () => anchors.forEach(a => a.removeEventListener('click', onClick))
  }, [])

  return React.createElement('div', {
    ...rest,
    ref: pRef || ref,
    dangerouslySetInnerHTML: { __html: html }
  })
}
