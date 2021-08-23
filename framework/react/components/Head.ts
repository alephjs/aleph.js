import {
  Children,
  createElement,
  Fragment,
  isValidElement,
  PropsWithChildren,
  ReactNode,
  useContext,
  useEffect,
  useMemo
} from 'https://esm.sh/react@17.0.2'
import util from '../../../shared/util.ts'
import { SSRContext } from '../context.ts'
import CustomScript from './CustomScript.ts'
import InlineStyle from './InlineStyle.ts'
import StyleLink from './StyleLink.ts'
import { inDeno } from '../helper.ts'

export default function Head(props: PropsWithChildren<{}>) {
  const { headElements } = useContext(SSRContext)
  const [els, forwardNodes] = useMemo(() => parse(props.children), [props.children])

  if (inDeno) {
    els.forEach(({ type, props }, key) => headElements.set(key, { type, props }))
  }

  useEffect(() => {
    const { document } = (window as any)
    const insertedEls: Array<Object> = []

    if (els.size > 0) {
      let charset = document.querySelector('meta[charset]')
      if (!charset) {
        charset = document.createElement('meta')
        charset.setAttribute('charset', 'utf-8')
        document.head.prepend(charset)
      }

      const anchor = document.createElement('meta')
      if (charset.nextElementSibling) {
        document.head.insertBefore(anchor, charset.nextElementSibling)
      } else {
        document.head.appendChild(anchor)
      }

      els.forEach(({ type, props }) => {
        if (type === 'script') {
          return
        }
        const el = document.createElement(type)
        Object.keys(props).forEach(key => {
          const value = props[key]
          if (key === 'children') {
            if (util.isFilledString(value)) {
              el.innerText = value
            } else if (util.isFilledArray(value)) {
              el.innerText = value.join('')
            }
          } else {
            el.setAttribute(key, String(value || ''))
          }
        })
        document.head.insertBefore(el, anchor)
        insertedEls.push(el)
      })
      document.head.removeChild(anchor)
    }

    return () => {
      insertedEls.forEach(el => document.head.removeChild(el))
    }
  }, [els])

  return createElement(Fragment, null, ...forwardNodes)
}

function parse(node: ReactNode): [Map<string, { type: string, props: Record<string, any> }>, ReactNode[]] {
  const els: Map<string, { type: string, props: Record<string, any> }> = new Map()
  const forwardNodes: ReactNode[] = []
  const parseFn = (node: ReactNode) => {
    Children.forEach(node, child => {
      if (!isValidElement(child)) {
        return
      }

      let { type, props } = child
      switch (type) {
        case Fragment:
          parseFn(props.children)
          break
        case StyleLink:
          forwardNodes.push(createElement(StyleLink, props))
          break
        case InlineStyle:
          forwardNodes.push(createElement(InlineStyle, props))
          break
        case CustomScript:
          forwardNodes.push(createElement(CustomScript, props))
          break
        case 'base':
        case 'title':
        case 'meta':
        case 'link':
        case 'style':
        case 'script':
        case 'no-script':
          let key = type
          if (type === 'meta') {
            const propKeys = Object.keys(props).map(k => k.toLowerCase())
            if (propKeys.includes('charset')) {
              return // ignore charset, always use utf-8
            }
            if (propKeys.includes('name')) {
              key += `[name=${JSON.stringify(props['name'])}]`
            } else if (propKeys.includes('property')) {
              key += `[property=${JSON.stringify(props['property'])}]`
            } else if (propKeys.includes('http-equiv')) {
              key += `[http-equiv=${JSON.stringify(props['http-equiv'])}]`
            } else {
              key += Object.keys(props).filter(k => !(/^content|children$/i.test(k))).map(k => `[${k.toLowerCase()}=${JSON.stringify(props[k])}]`).join('')
            }
          } else if (type !== 'title') {
            key += '-' + (els.size + 1)
          }
          // remove the children prop of base/meta/link
          if (['base', 'meta', 'link'].includes(type) && 'children' in props) {
            const { children, ...rest } = props
            els.set(key, { type, props: rest })
          } else {
            els.set(key, { type, props })
          }
          break
      }
    })
  }

  parseFn(node)
  return [els, forwardNodes]
}
