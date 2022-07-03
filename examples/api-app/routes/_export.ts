// Imports route modules for serverless env that doesn't support the dynamic import.
// This module will be updated automaticlly in develoment mode, do NOT edit it manually.

import * as $0 from "./index.ts";
import * as $1 from "./users/index.ts";
import * as $2 from "./users/$uid.ts";

export default {
  "/": $0,
  "/users/index": $1,
  "/users/:uid": $2,
};
