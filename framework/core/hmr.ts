import events from './events.ts'

interface Callback {
  (...args: any[]): void
}

class Module {
  private _url: string
  private _isLocked: boolean = false
  private _isAccepted: boolean = false
  private _acceptCallbacks: Callback[] = []

  get url() {
    return this._url
  }

  constructor(url: string) {
    this._url = url
  }

  lock(): void {
    this._isLocked = true
  }

  accept(callback?: Callback): void {
    if (this._isLocked) {
      return
    }
    if (!this._isAccepted) {
      sendMessage({ url: this._url, type: 'hotAccept' })
      this._isAccepted = true
    }
    if (callback) {
      this._acceptCallbacks.push(callback)
    }
  }

  async applyUpdate(updateUrl: string) {
    try {
      const module = await import(updateUrl + '?t=' + Date.now())
      this._acceptCallbacks.forEach(cb => cb(module))
    } catch (e) {
      location.reload()
    }
  }
}

const modules: Map<string, Module> = new Map()
const state: {
  socket: WebSocket | null
  messageQueue: string[]
} = {
  socket: null,
  messageQueue: []
}

function sendMessage(msg: any) {
  const json = JSON.stringify(msg)
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    state.messageQueue.push(json)
  } else {
    state.socket.send(json)
  }
}

export function connect(basePath: string) {
  const { location } = window as any
  const { protocol, host } = location
  const url = (protocol === 'https:' ? 'wss' : 'ws') + '://' + host + basePath.replace(/\/+$/, '') + '/_hmr'
  const ws = new WebSocket(url)

  ws.addEventListener('open', () => {
    state.socket = ws
    state.messageQueue.splice(0, state.messageQueue.length).forEach(msg => ws.send(msg))
    console.log('[HMR] listening for file changes...')
  })

  ws.addEventListener('close', () => {
    if (state.socket === null) {
      // re-connect
      setTimeout(() => {
        connect(basePath)
      }, 300)
    } else {
      state.socket = null
      console.log('[HMR] closed.')
      // reload the page when re-connected
      setInterval(() => {
        const ws = new WebSocket(url)
        ws.addEventListener('open', () => {
          location.reload()
        })
      }, 300)
    }
  })

  ws.addEventListener('message', ({ data }: { data?: string }) => {
    if (data) {
      try {
        const {
          type,
          url,
          updateUrl,
          routePath,
          isIndex,
        } = JSON.parse(data)
        switch (type) {
          case 'add':
            events.emit('add-module', {
              url,
              routePath,
              isIndex,
            })
            break
          case 'update':
            const mod = modules.get(url)
            if (mod) {
              mod.applyUpdate(updateUrl)
            }
            break
          case 'remove':
            if (modules.has(url)) {
              modules.delete(url)
              events.emit('remove-module', url)
            }
            break
        }
        console.log(`[HMR] ${type} module '${url}'`)
      } catch (err) {
        console.warn(err)
      }
    }
  })
}

export function createHotContext(url: string) {
  if (modules.has(url)) {
    const mod = modules.get(url)!
    mod.lock()
    return mod
  }

  const mod = new Module(url)
  modules.set(url, mod)
  return mod
}
