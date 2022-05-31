import { users } from "./index.ts";

export const GET = (_req: Request, ctx: Context) => {
  const user = users.find((u) => String(u.uid) === ctx.params.uid);
  if (user) {
    return Response.json(user);
  }
  return Response.json({ error: { message: "user not found", code: "userNotFound" } }, { status: 404 });
};

export const PATCH = async (req: Request, ctx: Context) => {
  const user = users.find((u) => String(u.uid) === ctx.params.uid);
  if (user) {
    const data = await req.formData();
    const name = data.get("name");
    if (typeof name !== "string" || name.length === 0) {
      return Response.json({ error: { message: "invalid name", code: "invalidName" } }, { status: 400 });
    }
    user.name = name;
    return Response.json(user);
  }
  return Response.json({ error: { message: "user not found", code: "userNotFound" } }, { status: 404 });
};

export const DELETE = (_req: Request, ctx: Context) => {
  const index = users.findIndex((u) => String(u.uid) === ctx.params.uid);
  if (index) {
    return Response.json(users.splice(index, 1)[0]);
  }
  return Response.json({ error: { message: "user not found", code: "userNotFound" } }, { status: 404 });
};
