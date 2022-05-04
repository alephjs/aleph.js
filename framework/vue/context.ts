import { ref } from "vue";

export const RouterContext = ref({
  url: new URL("http://localhost/"),
  params: {},
});
