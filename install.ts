import { parse } from 'https://deno.land/std@0.96.0/flags/mod.ts'
import upgrade from './cli/upgrade.ts'

if (import.meta.main) {
  const { _: args, ...options } = parse(Deno.args)
  await upgrade(options.v || options.version || args[0] || 'latest', true)
}
