import { createApp } from "./router.ts";
import { createCSRContext } from "../core/router.ts";

export async function bootstrap(options?: { root?: string | HTMLElement }) {
  const { root = "#root" } = options ?? {};
  const hydrate = !!document.head.querySelector("script#ssr-data");
  const csrContext = await createCSRContext();
  createApp({ csrContext }).mount(root, hydrate);
}

export { useData } from "./data.ts";
export { useRouter } from "./router.ts";
export { Link } from "./link.ts";
export { Head } from "./head.ts";
