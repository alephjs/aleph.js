import upgrade from './cli/upgrade.ts'
import { flags } from './deps.ts'

if (import.meta.main) {
  const { _: args, ...options } = flags.parse(Deno.args)
  await upgrade(options.v || options.version || args[0] || 'latest')
}
