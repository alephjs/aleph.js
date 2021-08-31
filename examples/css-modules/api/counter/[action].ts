import type { APIHandler } from 'aleph/types.d.ts'

export const handler: APIHandler = ({ router, response }) => {
  let count = parseInt(localStorage.getItem('count') || '0')

  switch (router.params['action']) {
    case 'increase':
      count++
      localStorage.setItem('count', count.toString())
      response.json({ count })
      break
    case 'decrease':
      count--
      localStorage.setItem('count', count.toString())
      response.json({ count })
      break
    default:
      response.status = 400
      response.json({
        error: 'UnknownAction',
        status: 400,
        message: `undefined action '${router.params['action']}'`
      })
      break
  }
}
