import type { APIHandler } from 'aleph/types.d.ts'

type MyAPIData = {
  foo: "bar"
  fizz: "buzz"
}

export const handler: APIHandler<MyAPIData> = ({ response, data }) => {
  data.set("foo", "bar")
  data.set("fizz", "buzz")

  const count = parseInt(localStorage.getItem('count') || '0')
  response.json({ count })
}
