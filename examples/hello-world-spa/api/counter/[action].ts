import type { APIRequest } from 'aleph/types.ts'

export default async function handler({ router, resp }: APIRequest) {
  let count = parseInt(localStorage.getItem('count') || '0')

  switch (router.params['action']) {
    case 'increase':
      count++
      localStorage.setItem('count', count.toString())
      resp.json({ count })
      break
    case 'decrease':
      count--
      localStorage.setItem('count', count.toString())
      resp.json({ count })
      break
    default:
      resp.status(400).json({
        error: 'UnknownAction',
        status: 400,
        message: `undefined action '${router.params['action']}'`
      })
      break
  }
}
