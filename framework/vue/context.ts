import { Ref, ref } from "vue";

export const RouterContext = ref({
  url: new URL("http://localhost/"),
  params: {},
});

type DataContextProps = {
  dataUrl: string;
  dataCache: Map<any, any>;
  ssrHeadCollection?: string[];
};

export const DataContext: DataContextProps = {
  dataUrl: "/",
  dataCache: new Map(),
  ssrHeadCollection: [],
};
