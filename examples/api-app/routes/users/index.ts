export type User = {
  uid: number;
  name: string;
  createdAt: string;
};

export const users: User[] = [
  { uid: 1, name: "john doe", createdAt: "2020-01-01T00:00:00.000Z" },
  { uid: 2, name: "mike johnson", createdAt: "2020-01-02T00:00:00.000Z" },
  { uid: 3, name: "mary jane", createdAt: "2020-01-03T00:00:00.000Z" },
  { uid: 4, name: "larry wall", createdAt: "2020-01-04T00:00:00.000Z" },
];

export const GET = (req: Request) => {
  const url = new URL(req.url);
  return Response.json(users.map((user) => ({ ...user, url: `${url.origin}/users/${user.uid}` })));
};

export const POST = async (req: Request) => {
  const data = await req.formData();
  const name = data.get("name");
  if (typeof name !== "string" || name.length === 0) {
    return Response.json({ error: { message: "invalid name", code: "invalidName" } }, { status: 400 });
  }
  const user: User = { uid: users.length + 1, name, createdAt: new Date().toISOString() };
  users.push(user);
  return Response.json(user);
};
