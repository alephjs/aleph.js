import util from '../../shared/util.ts'
import events from './events.ts'

export async function redirect(url: string, replace?: boolean) {
  const { location, history } = window as any

  if (!util.isNEString(url)) {
    return
  }

  if (util.isLikelyHttpURL(url) || url.startsWith('file://') || url.startsWith('mailto:')) {
    location.href = url
    return
  }

  url = util.cleanPath(url)
  if (replace) {
    history.replaceState(null, '', url)
  } else {
    history.pushState(null, '', url)
  }
  events.emit('popstate', { type: 'popstate', resetScroll: true })
}
