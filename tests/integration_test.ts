import {
  assert,
  assertEquals,
  assertStringIncludes
} from 'std/testing/asserts.ts'
import { emptyDir } from 'std/fs/mod.ts'
import { BufReader } from 'std/io/bufio.ts'
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.15-alpha/deno-dom-wasm.ts'

Deno.test('integration: dev command', async () => {
  const distDir = './examples/hello-world/dist'
  await emptyDir(distDir)
  localStorage.removeItem('count')

  const buildCmd = aleph(['dev', './examples/hello-world', '--port', '8080'])
  try {
    const port = await waitForServerToStart(buildCmd)

    // Call /api/counter/increase twice
    let res = await fetch(`http://localhost:${port}/api/counter/increase`)
    assert(res.ok)
    assertEquals(await res.json(), { count: 1 })

    res = await fetch(`http://localhost:${port}/api/counter/increase`)
    assert(res.ok)
    assertEquals(await res.json(), { count: 2 })

    // Get index page
    const parser = new DOMParser()
    res = await fetch(`http://localhost:${port}`)
    const html = await res.text()
    const doc = parser.parseFromString(html, 'text/html')
    assert(doc)

    const copyinfo = doc.querySelector('.copyinfo')
    assert(copyinfo)
    assertStringIncludes(copyinfo.textContent, 'Built by Aleph.js in Deno')
  } finally {
    cleanupAlephProcess(buildCmd)
  }
})

function aleph(cmd: Array<string>): Deno.Process {
  return Deno.run({
    cmd: [
      Deno.execPath(),
      'run',
      '-A',
      '--unstable',
      '--location=http://localhost',
      'cli.ts',
      ...cmd
    ],
    env: {
      'ALEPH_DEV': 'true',
      'NO_COLOR': 'true'
    },
    stdout: "piped",
  })
}

function cleanupAlephProcess(process: Deno.Process): void {
  if (process.stdout) {
    process.stdout.close()
  }
  process.close()
}

// Waits for the aleph server to start and returns a port
async function waitForServerToStart(process: Deno.Process): Promise<number> {
  assert(process.stdout)
  const buf = BufReader.create(process.stdout)
  const decoder = new TextDecoder()
  while (true) {
    const result = await buf.readLine()
    if (result == null) {
      throw new Error('Unexpected EOF')
    }

    const { line } = result
    const match = /^INFO Server ready on http:\/\/localhost:(\d+).*$/.exec(decoder.decode(line))
    if (match) {
      const [, port] = match
      return parseInt(port)
    }
  }
}
