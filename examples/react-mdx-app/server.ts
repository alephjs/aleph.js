import { serve } from "aleph/server";
import react from "aleph/plugins/react";
import mdx from "aleph/plugins/mdx";
import routes from "./routes/_export.ts";

// check https://mdxjs.com/docs/extending-mdx
import remarkFrontmatter from "https://esm.sh/v110/remark-frontmatter@4.0.1";
import remarkGFM from "https://esm.sh/v110/remark-gfm@3.0.1";
import rehypeHighlight from "https://esm.sh/v110/rehype-highlight@5.0.2";
import rehypeSlug from "https://esm.sh/v110/rehype-slug@5.0.1";

serve({
  baseUrl: import.meta.url,
  plugins: [
    mdx({
      remarkPlugins: [remarkFrontmatter, remarkGFM],
      rehypePlugins: [rehypeHighlight, rehypeSlug],
      providerImportSource: "@mdx-js/react",
    }),
    react({ ssr: true }),
  ],
  router: { routes },
});
