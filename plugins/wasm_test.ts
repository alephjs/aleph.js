import { assertEquals } from 'https://deno.land/std@0.90.0/testing/asserts.ts'
import wasmLoader from './wasm.ts'

Deno.test('wasm loader', async () => {
  const wasmBytes = new Uint8Array([
    0, 97, 115, 109, 1, 0, 0, 0, 1, 133, 128, 128, 128, 0, 1, 96, 0, 1, 127,
    3, 130, 128, 128, 128, 0, 1, 0, 4, 132, 128, 128, 128, 0, 1, 112, 0, 0,
    5, 131, 128, 128, 128, 0, 1, 0, 1, 6, 129, 128, 128, 128, 0, 0, 7, 145,
    128, 128, 128, 0, 2, 6, 109, 101, 109, 111, 114, 121, 2, 0, 4, 109, 97,
    105, 110, 0, 0, 10, 138, 128, 128, 128, 0, 1, 132, 128, 128, 128, 0, 0,
    65, 42, 11
  ])
  const loader = wasmLoader()
  const { code } = await loader.transform!({
    url: '42.wasm',
    content: wasmBytes
  })
  const jsfile = (await Deno.makeTempFile()) + '.js'
  await Deno.writeTextFile(jsfile, code)
  const { default: wasm } = await import('file://' + jsfile)
  assertEquals(loader.test.test('/test.wasm'), true)
  assertEquals(wasm.main(), 42)
})
