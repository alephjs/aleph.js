import type { APIRequest } from 'aleph/types.ts'

const global = globalThis as any

export default async function handler(req: APIRequest) {
    let count = global['__count'] || (global['__count'] = 0)
    switch (req.params.action) {
        case 'increase':
            count++
            global['__count'] = count
            req.json({ count })
            break
        case 'decrease':
            count--
            global['__count'] = count
            req.json({ count })
            break
        default:
            req.status(400).json({ error: 'UnknownAction', status: 400, message: `undefined acton '${req.params.action}'` })
            break
    }
}
