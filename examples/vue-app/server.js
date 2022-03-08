import { serve } from "aleph/server";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import app from "./app.vue";

serve({
  ssr: async (_ctx) => await renderToString(createSSRApp(app)),
});
