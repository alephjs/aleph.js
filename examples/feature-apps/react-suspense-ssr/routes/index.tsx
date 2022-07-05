import { Suspense } from "react";
import { Head } from "aleph/react";
import Spinner from "../components/Spinner.tsx";
import Sidebar from "../components/Sidebar.tsx";
import Post from "../components/Post.tsx";
import Comments from "../components/Comments.tsx";

// This demo is artificially slowed down.
// Please update `delay` in ms to adjust how much different things are slowed down.
const delay = 3000;

export const data: Data = {
  get: async () => {
    await new Promise((resolve) => setTimeout(resolve, delay));
    return {
      comments: [
        "Wait, it doesn't wait for React to load?",
        "How does this even work?",
        "I like marshmallows",
      ],
    };
  },
};

export default function Index() {
  return (
    <main>
      <Head>
        <title>React 18 Suspense SSR</title>
      </Head>
      <aside className="sidebar">
        <Suspense fallback={<Spinner />}>
          <Sidebar />
        </Suspense>
      </aside>
      <article className="post">
        <Suspense fallback={<Spinner />}>
          <Post />
        </Suspense>
        <section className="comments">
          <h2>Comments</h2>
          <Suspense fallback={<Spinner />}>
            <Comments />
          </Suspense>
        </section>
        <h2>Thanks for reading!</h2>
      </article>
    </main>
  );
}
