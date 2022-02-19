import { parse as parseArgs } from "https://deno.land/std@0.125.0/flags/mod.ts";
import log, { type LevelName } from "./log.ts";
import util from "./util.ts";

export function parse() {
  const { _: args, ...options } = parseArgs(Deno.args);

  // set log level
  const l = options.L || options["log-level"];
  if (util.isFilledString(l)) {
    log.setLevel(l.toLowerCase() as LevelName);
  }

  return { args, options };
}

/** parse port number */
export function parsePortNumber(v: string): number {
  const num = parseInt(v);
  if (isNaN(num) || !Number.isInteger(num) || num <= 0 || num >= 1 << 16) {
    throw new Error(`invalid port '${v}'`);
  }
  return num;
}

/** get flag value by given keys. */
export function getFlag(flags: Record<string, unknown>, keys: string[]): string | undefined;
export function getFlag(flags: Record<string, unknown>, keys: string[], defaultValue: string): string;
export function getFlag(flags: Record<string, unknown>, keys: string[], defaultValue?: string): string | undefined {
  let value = defaultValue;
  for (const key of keys) {
    if (key in flags) {
      value = String(flags[key]);
      break;
    }
  }
  return value;
}
