import type { APIRequest } from 'aleph/types.ts'

const store = globalThis as any

export default async function handler(req: APIRequest) {
  let count = store.$count || 0

  switch (req.params.action) {
    case 'increase':
      count++
      store.$count = count
      req.json({ count })
      break
    case 'decrease':
      count--
      store.$count = count
      req.json({ count })
      break
    default:
      req.status(400).json({
        error: 'UnknownAction',
        status: 400,
        message: `undefined action '${req.params.action}'`
      })
      break
  }
}
