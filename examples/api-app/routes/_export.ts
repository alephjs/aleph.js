// Exports router modules for serverless env that doesn't support the dynamic import.
// This module will be updated automatically in development mode, do NOT edit it manually.

import * as $0 from "./ws.ts";
import * as $1 from "./index.ts";
import * as $2 from "./users/index.ts";
import * as $3 from "./users/$uid.ts";

export default {
  "/ws": $0,
  "/": $1,
  "/users/index": $2,
  "/users/:uid": $3,
};
