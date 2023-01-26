// Pre-imports router modules for serverless env that doesn't support the dynamic import.
// This module will be updated automaticlly in develoment mode, do NOT edit it manually.

import * as uno from "@unocss/core";
Reflect.set(globalThis, "UNOCSS_CORE", uno);

import * as $3 from "./_404.tsx";
import * as $4 from "./_app.tsx";
import * as $5 from "./index.tsx";
import * as $6 from "./todos.tsx";

export default {
  "/_404": $3,
  "/_app": $4,
  "/": $5,
  "/todos": $6,
};
