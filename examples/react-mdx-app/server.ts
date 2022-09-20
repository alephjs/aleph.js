import { serve } from "aleph/react-server";
import MDXLoader from "aleph/react/mdx-loader";
import routes from "./routes/_export.ts";

// check https://mdxjs.com/docs/extending-mdx
import remarkFrontmatter from "https://esm.sh/remark-frontmatter@4.0.1";
import rehypeHighlight from "https://esm.sh/rehype-highlight@5.0.2";

serve({
  baseUrl: import.meta.url,
  loaders: [
    new MDXLoader({
      remarkPlugins: [remarkFrontmatter],
      rehypePlugins: [rehypeHighlight],
    }),
  ],
  router: {
    glob: "./routes/**/*.{tsx,mdx,md}",
    routes,
  },
  ssr: true,
});
