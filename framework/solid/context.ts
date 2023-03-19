import { type Accessor, createContext } from "solid-js";

export type RouterContextProps = {
  url: Accessor<URL>;
  params: Accessor<Record<string, string>>;
  e404: Accessor<boolean>;
};

/** Context for the router. */
export const RouterContext = createContext<RouterContextProps>();
