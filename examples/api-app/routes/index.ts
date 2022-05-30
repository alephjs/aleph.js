export const GET = (req: Request) => {
  const url = new URL(req.url);
  return Response.json({
    "users_url": `${url.origin}/users`,
    "user_url": `${url.origin}/users/{user}`,
  });
};
