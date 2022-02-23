import type { Dispatch, SetStateAction } from "https://esm.sh/react@17.0.2";
import { createContext } from "https://esm.sh/react@17.0.2";

export type ContextProps = {
  url: URL;
  setUrl: Dispatch<SetStateAction<URL>>;
  dataCache: Map<string, { data?: unknown; dataCacheTtl?: number }>;
  ssrHeadCollection?: string[];
};

export default createContext<ContextProps>({
  url: new URL("http://localhost/"),
  dataCache: new Map(),
  setUrl: () => {},
});
