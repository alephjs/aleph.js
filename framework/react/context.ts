import { createContext } from "react";

export type RouterContextProps = {
  url: URL;
};

export const RouterContext = createContext<RouterContextProps>({
  url: new URL("http://localhost/"),
});

export type DataContextProps = {
  dataUrl: string;
  dataCache: Map<string, { data?: unknown; dataCacheTtl?: number; dataExpires?: number }>;
  ssrHeadCollection?: string[];
};

export const DataContext = createContext<DataContextProps>({
  dataUrl: "/",
  dataCache: new Map(),
});

export type ForwardPropsContextProps = {
  props: Record<string, unknown>;
};

export const ForwardPropsContext = createContext<ForwardPropsContextProps>({
  props: {},
});
