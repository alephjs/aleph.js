import { assertEquals, assert } from 'https://deno.land/std/testing/asserts.ts';
import env from './env.ts';

Deno.env.set('TEST_ENV_VAR', '1')

Deno.test('env loader should accept ts files', async () => {
  const plugin = env();
  assert(plugin.test.test('mod.ts'));
})

Deno.test('env loader should accept tsx files', async () => {
  const plugin = env();
  assert(plugin.test.test('mod.tsx'));
})

Deno.test('env loader should accept js files', async () => {
  const plugin = env();
  assert(plugin.test.test('mod.js'));
})

Deno.test('env loader should accept jsx files', async () => {
  const plugin = env();
  assert(plugin.test.test('mod.jsx'));
})

Deno.test('env loader should be accept HMR files', async () => {
  const plugin = env();
  assert(plugin.acceptHMR);
})

Deno.test('env loader should replace env variables', async () => {
  const plugin = env();
  const { code, loader } = await plugin.transform?.(
    (new TextEncoder).encode('const start = {{TEST_ENV_VAR}};'),
    'mod.ts'
  )!
  assertEquals(code, 'const start = 1;')
})
