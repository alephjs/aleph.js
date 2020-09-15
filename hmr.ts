import events from './events.ts'
import util from './util.ts'
import runtime from './vendor/react-refresh/runtime.js'

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
    #id: string
    #isLocked: boolean = false
    #isAccepted: boolean = false
    #acceptCallbacks: Callback[] = []

    get id() {
        return this.#id
    }

    constructor(id: string) {
        this.#id = id
    }

    lock(): void {
        this.#isLocked = true
    }

    accept(callback?: () => void): void {
        if (this.#isLocked) {
            return
        }
        if (!this.#isAccepted) {
            sendMessage({ id: this.id, type: 'hotAccept' })
            this.#isAccepted = true
        }
        if (callback) {
            this.#acceptCallbacks.push(callback)
        }
    }

    async applyUpdate(updateUrl: string) {
        try {
            const module = await import(updateUrl + '?t=' + Date.now())
            this.#acceptCallbacks.forEach(cb => cb(module))
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
})

socket.addEventListener('message', ({ data: rawData }: { data?: string }) => {
    if (!rawData) {
        return
    }
    const { type, id, updateUrl, hash } = JSON.parse(rawData)
    if (type === 'add') {
        events.emit('add-module', id, hash)
        console.log(`[HMR] add module ${JSON.stringify({ id, hash })}`)
    } else if (type === 'update' && modules.has(id)) {
        const mod = modules.get(id)!
        mod.applyUpdate(updateUrl)
        console.log(`[HMR] update module '${id}'`)
    } else if (type === 'remove' && modules.has(id)) {
        modules.delete(id)
        events.emit('remove-module', id)
        console.log(`[HMR] remove module '${id}'`)
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

console.log('[HMR] listening for file changes...')
