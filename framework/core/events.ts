/** @format */

import mitt from "https://esm.sh/v126/mitt@3.0.0";

// shared event emitter for client(browser)
export default mitt<Record<string, Record<string, unknown>>>();
