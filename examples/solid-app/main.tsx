import { hydrate } from "solid-js/web";

const { default: App } = __aleph.getRouteModule("./routes/index.tsx");
hydrate(() => <App />, document.getElementById("root")!);
