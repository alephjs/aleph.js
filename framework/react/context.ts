import { createContext } from "https://esm.sh/react@17.0.2";

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
