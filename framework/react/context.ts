import type { ReactNode, ReactPortal } from "react";
import { createContext } from "react";

export type RouterContextProps = {
  url: URL;
  params: Record<string, string>;
  ssrHeadCollection?: string[];
  createPortal?: (children: ReactNode, container: Element, key?: null | string) => ReactPortal;
};

export const RouterContext = createContext<RouterContextProps>({
  url: new URL("http://localhost/"),
  params: {},
});

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

export type UpdateStrategy<T = unknown> = "none" | "replace" | {
  optimisticUpdate?: (data: T) => T;
  onFailure?: (error: Error) => void;
  replace?: boolean;
};

export type Mutation<T> = {
  [key in "post" | "put" | "patch" | "delete"]: (
    data?: unknown,
    updateStrategy?: UpdateStrategy<T>,
  ) => Promise<Response>;
};

export type DataContextProps<T = unknown> = {
  suspenseData?: { current?: T };
  data: T;
  isMutating: HttpMethod | boolean;
  mutation: Mutation<T>;
  reload: (signal?: AbortSignal) => Promise<void>;
};

export const DataContext = createContext<DataContextProps>({
  data: undefined,
  isMutating: false,
  mutation: {
    post: () => Promise.resolve(new Response(null)),
    put: () => Promise.resolve(new Response(null)),
    patch: () => Promise.resolve(new Response(null)),
    delete: () => Promise.resolve(new Response(null)),
  },
  reload: () => Promise.resolve(undefined),
});

export type ForwardPropsContextProps = {
  props: Record<string, unknown>;
};

export const ForwardPropsContext = createContext<ForwardPropsContextProps>({
  props: {},
});
