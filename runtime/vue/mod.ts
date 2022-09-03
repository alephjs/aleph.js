import { createApp } from "./router.ts";

export function bootstrap(options?: { root?: string | HTMLElement; hydrate?: boolean }) {
  const { root = "#root", hydrate } = options ?? {};
  createApp().mount(root, hydrate);
}

export { useData } from "./data.ts";
export { useRouter } from "./router.ts";
export { Link } from "./link.ts";
export { Head } from "./head.ts";
