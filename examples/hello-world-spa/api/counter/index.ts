import type { APIRequest } from 'aleph/types.ts'

const store = globalThis as any

export default async function handler(req: APIRequest) {
  req.json({ count: store.$count || 0 })
}
