import type { APIRequest } from 'aleph/types.ts'

export default function handler(req: APIRequest) {
  console.log(`req: `, req)
  console.log(`req.params: `, req.params)
  console.log(`req.params.action: `, req.params.action)
  req.status(200).json({ name: req.params.action })
}
