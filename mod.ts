export { VERSION } from './version.ts'

export function isDev(): boolean {
  return Deno.env.get('ALEPH_BUILD_MODE') === 'development'
}
