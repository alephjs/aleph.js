import { useData } from "aleph/react";
import type { GithubUser } from "../oauth.ts";

export const data: Data<{ user: GithubUser }> = {
  get: (_req, ctx) => {
    return { user: ctx.user as GithubUser };
  },
};

export default function Index() {
  const { data: { user } } = useData<{ user: GithubUser }>();
  return (
    <div className="w-screen h-screen flex items-center justify-center">
      <div className="p-8 bg-gray-100 rounded-lg shadow-lg inline-flex items-center">
        <img src={user.avatar_url} className="w-8 h-8" />
        <strong>{user.name}</strong>
      </div>
    </div>
  );
}
