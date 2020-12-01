import events from './shared/events.ts'
import { hashShort } from './shared/util.ts'

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

    accept(callback?: () => void): void {
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

const { location } = window as any
const { protocol, host } = location
const modules: Map<string, Module> = new Map()
const messageQueue: any[] = []
const socket = new WebSocket((protocol === 'https:' ? 'wss' : 'ws') + '://' + host + '/_hmr', /*  'aleph-hmr' */)

socket.addEventListener('open', () => {
    messageQueue.forEach(msg => socket.send(JSON.stringify(msg)))
    messageQueue.splice(0, messageQueue.length)
    console.log('[HMR] listening for file changes...')
})

socket.addEventListener('close', () => {
    location.reload()
})

socket.addEventListener('message', ({ data: rawData }: { data?: string }) => {
    if (rawData) {
        try {
            const { type, url, hash, updateUrl } = JSON.parse(rawData)
            switch (type) {
                case 'add':
                    events.emit('add-module', { url, hash })
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
            console.log(`[HMR]${hash ? ' [' + hash.slice(0, hashShort) + ']' : ''} ${type} module '${url}'`)
        } catch (err) {
            console.warn(err)
        }
    }
})

function sendMessage(msg: any) {
    if (socket.readyState !== socket.OPEN) {
        messageQueue.push(msg)
    } else {
        socket.send(JSON.stringify(msg))
    }
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
