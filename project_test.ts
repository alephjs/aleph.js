import { assertEquals } from 'https://deno.land/std/testing/asserts.ts'
import { Project } from './project.ts'
import { path } from './std.ts'

Deno.test({
    name: 'project build(hello world)',
    async fn() {
        const output: string[] = []
        const appDir = path.resolve('./examples/hello-world')
        const project = new Project(appDir, 'production')
        await project.build()
        for await (const entry of Deno.readDir(path.resolve(appDir, 'dist'))) {
            output.push(entry.name)
        }
        output.sort()
        assertEquals(output, [
            '404.html',
            '_aleph',
            '_fallback.html',
            'favicon.ico',
            'index.html',
            'logo.svg'
        ])
    },
    sanitizeResources: false,
    sanitizeOps: false
})
