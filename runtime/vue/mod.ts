import { createApp } from "./router.ts";

export function bootstrap(options?: { mountPoint?: string | HTMLElement; hydrate?: boolean }) {
  const { mountPoint, hydrate } = options ?? {};
  createApp().mount(mountPoint, hydrate);
}

export { useData } from "./data.ts";
export { useRouter } from "./router.ts";
export { Link } from "./link.ts";
export { Head } from "./head.ts";
