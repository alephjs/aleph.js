import type { APIHandler, APIContext } from 'aleph/types.d.ts'
import data from './data.json'

const create = async (
  { response }: APIContext,
  db: string,
) => {
  const count = parseInt(localStorage.getItem('count') || '0')
  response.json({ count, db: db, data })
}

const requestWithMongo = (handler: typeof create): APIHandler =>
  async (context) => {
    await handler(context, "mongo")
  }

export const handler: APIHandler = requestWithMongo(create)
