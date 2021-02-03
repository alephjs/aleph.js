import type { APIRequest } from 'aleph/types.ts'

const global = globalThis as any

export default async function handler(req: APIRequest) {
    const count = global['__count'] || (global['__count'] = 0)
    req.json({ count })
}
