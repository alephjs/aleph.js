import type { ReactNode, ReactPortal } from "react";
import { createContext } from "react";

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

export type RouterContextProps = {
  url: URL;
  params: Record<string, string>;
  e404?: boolean;
  ssrHeadCollection?: string[];
  createPortal?: (children: ReactNode, container: Element, key?: null | string) => ReactPortal;
};

export type DataContextProps<T = unknown> = {
  deferedData?: { current?: T };
  data: T;
  isMutating: HttpMethod | boolean;
  mutation: Mutation<T>;
  reload: (signal?: AbortSignal) => Promise<void>;
};

export type ForwardPropsContextProps = {
  props: Record<string, unknown>;
};

/** Context for the router. */
export const RouterContext = createContext<RouterContextProps>({
  url: new URL("http://localhost/"),
  params: {},
});
RouterContext.displayName = "RouterContext";

/** Context for the router data. */
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
DataContext.displayName = "DataContext";

/** Context for the forwarded props. */
export const ForwardPropsContext = createContext<ForwardPropsContextProps>({
  props: {},
});
ForwardPropsContext.displayName = "ForwardPropsContext";
