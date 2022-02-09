import type { Dispatch, SetStateAction } from "react";
import { createContext } from "react";

export type ContextProps = {
  url: URL;
  setUrl: Dispatch<SetStateAction<URL>>;
  dataCache: Map<string, { data: any; expires?: number }>;
  ssrHeadCollection?: string[];
};

export default createContext<ContextProps>({
  url: new URL("http://localhost/"),
  dataCache: new Map(),
  setUrl: () => {},
});
