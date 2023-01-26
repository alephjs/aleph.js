// Pre-imports router modules for serverless env that doesn't support the dynamic import.
// This module will be updated automaticlly in develoment mode, do NOT edit it manually.

import * as uno from "@unocss/core";
Reflect.set(globalThis, "UNOCSS_CORE", uno);

import * as $0 from "./index.tsx";

export default {
  "/": $0,
};
