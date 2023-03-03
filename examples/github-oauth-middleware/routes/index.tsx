import { useData } from "aleph/react";
import type { GithubUser } from "../middlewares/oauth.ts";

export const data = (_req: Request, ctx: Context) => {
  return Response.json({ user: ctx.user as GithubUser });
};

export default function Index() {
  const { data: { user } } = useData<{ user: GithubUser }>();
  return (
    <div className="w-screen h-screen flex items-center justify-center">
      <div className="px-8 py-4 border border-gray-200 rounded-xl shadow-2xl inline-flex items-center gap-2">
        <img src={user.avatar_url} className="w-7 h-7 rounded-full" />
        <strong className="text-2xl font-bold">{user.name}</strong>
      </div>
    </div>
  );
}
