import runtime from 'https://esm.sh/react-refresh/runtime?dev'
import events from './events.ts'
import util, { hashShort } from './util.ts'

interface Callback {
    (...args: any[]): void
}

// react-refresh
// @link https://github.com/facebook/react/issues/16604#issuecomment-528663101
runtime.injectIntoGlobalHook(window)
Object.assign(window, {
    $RefreshReg$: () => { },
    $RefreshSig$: () => (type: any) => type
})
export const performReactRefresh = util.debounce(runtime.performReactRefresh, 30)
export const RefreshRuntime = runtime

class Module {
    private _id: string
    private _isLocked: boolean = false
    private _isAccepted: boolean = false
    private _acceptCallbacks: Callback[] = []

    get id() {
        return this._id
    }

    constructor(id: string) {
        this._id = id
    }

    lock(): void {
        this._isLocked = true
    }

    accept(callback?: () => void): void {
        if (this._isLocked) {
            return
        }
        if (!this._isAccepted) {
            sendMessage({ id: this.id, type: 'hotAccept' })
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
            const { type, moduleId, hash, updateUrl } = JSON.parse(rawData)
            switch (type) {
                case 'add':
                    events.emit('add-module', { moduleId, hash })
                    break
                case 'update':
                    const mod = modules.get(moduleId)
                    if (mod) {
                        mod.applyUpdate(updateUrl)
                    }
                    break
                case 'remove':
                    if (modules.has(moduleId)) {
                        modules.delete(moduleId)
                        events.emit('remove-module', moduleId)
                    }
                    break
            }
            console.log(`[HMR]${hash ? ' [' + hash.slice(0, hashShort) + ']' : ''} ${type} module '${moduleId}'`)
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

export function createHotContext(id: string) {
    if (modules.has(id)) {
        const mod = modules.get(id)!
        mod.lock()
        return mod
    }

    const mod = new Module(id)
    modules.set(id, mod)
    return mod
}
