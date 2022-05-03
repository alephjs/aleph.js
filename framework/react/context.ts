import type { ReactNode, ReactPortal } from "react";
import { createContext } from "react";

export type RouterContextProps = {
  url: URL;
  params: Record<string, string>;
  createPortal?: (children: ReactNode, container: Element, key?: null | string) => ReactPortal;
};

export const RouterContext = createContext<RouterContextProps>({
  url: new URL("http://localhost/"),
  params: {},
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
