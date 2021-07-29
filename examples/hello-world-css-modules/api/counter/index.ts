import type { APIRequest } from 'aleph/types.ts'

export default async function handler({ response: resp }: APIRequest) {
  const count = parseInt(localStorage.getItem('count') || '0')
  resp.json({ count })
}