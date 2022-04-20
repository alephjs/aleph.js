import { createContext } from "react";

export type RouterContextProps = {
  url: URL;
  params: Record<string, string>;
};

export const RouterContext = createContext<RouterContextProps>({
  url: new URL("http://localhost/"),
  params: {},
});

export type DataContextProps = {
  dataUrl: string;
  dataCache: Map<string, { data?: unknown; dataCacheTtl?: number; dataExpires?: number; error?: Error }>;
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
