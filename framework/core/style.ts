import util from '../../shared/util.ts'

export const clientStyles = new Map<string, string>()

export function removeCSS(url: string, recoverable?: boolean) {
  const { document } = window as any
  Array.from(document.head.children).forEach((el: any) => {
    if (el.getAttribute('data-module-id') === url) {
      if (recoverable) {
        const tag = el.tagName.toLowerCase()
        if (tag === 'style') {
          clientStyles.set(url, el.innerHTML)
        } else if (tag === 'link') {
          clientStyles.set(url, '')
        }
      }
      document.head.removeChild(el)
    }
  })
}

export function recoverCSS(url: string) {
  if (clientStyles.has(url)) {
    const css = clientStyles.get(url)!
    if (css === '' && util.isLikelyHttpURL(url)) {
      applyCSS(url)
    } else {
      applyCSS(url, css)
    }
  }
}

export function applyCSS(url: string, css?: string) {
  if (!util.inDeno) {
    const { document } = window as any
    const ssr = Array.from<any>(document.head.children).find((el: any) => {
      return el.getAttribute('data-module-id') === url && el.hasAttribute('ssr')
    })
    if (ssr) {
      // apply the css at next time
      ssr.removeAttribute('ssr')
    } else {
      const prevEls = Array.from(document.head.children).filter((el: any) => {
        return el.getAttribute('data-module-id') === url
      })
      let el: any
      if (css !== undefined) {
        el = document.createElement('style')
        el.type = 'text/css'
        el.appendChild(document.createTextNode(css))
      } else if (util.isLikelyHttpURL(url)) {
        el = document.createElement('link')
        el.rel = 'stylesheet'
        el.href = url
      } else {
        throw new Error('applyCSS: missing css')
      }
      el.setAttribute('data-module-id', url)
      document.head.appendChild(el)
      if (prevEls.length > 0) {
        prevEls.forEach(el => document.head.removeChild(el))
      }
    }
  }
}
