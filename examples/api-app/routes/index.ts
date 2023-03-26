// GET "/"
export function GET(req: Request, ctx: Context) {
  const url = new URL(req.url);
  console.log("[middleware:foo]", ctx.foo);
  return Response.json({
    "users_url": `${url.origin}/users`,
    "user_url": `${url.origin}/users/{user}`,
    "websocket_url": `${url.protocol === "https:" ? "wss" : "ws"}://${url.host}/ws`,
  });
}
