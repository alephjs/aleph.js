/** @format */

import { serve } from "aleph/server";
import denoDeploy from "aleph/plugins/deploy";
import react from "aleph/plugins/react";
import mdx from "aleph/plugins/mdx";
import modules from "./routes/_export.ts";

// check https://mdxjs.com/docs/extending-mdx
import remarkFrontmatter from "https://esm.sh/v126/remark-frontmatter@4.0.1";
import remarkGFM from "https://esm.sh/v126/remark-gfm@3.0.1";
import rehypeHighlight from "https://esm.sh/v126/rehype-highlight@5.0.2";
import rehypeSlug from "https://esm.sh/v126/rehype-slug@5.0.1";

serve({
  plugins: [
    denoDeploy({ modules }),
    mdx({
      remarkPlugins: [remarkFrontmatter, remarkGFM],
      rehypePlugins: [rehypeHighlight, rehypeSlug],
      providerImportSource: "@mdx-js/react",
    }),
    react({ ssr: true }),
  ],
});
