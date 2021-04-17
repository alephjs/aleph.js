import { assert } from 'std/testing/asserts.ts'
import { Application } from '../server/app.ts'

Deno.test('bundler/mod', async () => {
    await Deno.mkdir('./bundler/infinite-compile-loop-test')
    await Deno.writeTextFile('./bundler/infinite-compile-loop-test/app.tsx', `
        import { Test as test } from './app.tsx'
        export const Test = null;
    `)

    const app = new Application('./bundler/infinite-compile-loop-test', 'production', true)
    const result = await new Promise(resolve => {
        const intervalID = setInterval(() => {
            if (app.bundlerCompileCounter > 100) {
                resolve(false)
            }
        }, 10)
        app.ready.then(() => {
            clearInterval(intervalID)
            resolve(true)
        }).catch((error: Error) => {
            if (error.message !== "No such file") {
                clearInterval(intervalID)
                throw error
            }
        })
    })

    await Deno.remove('./bundler/infinite-compile-loop-test', { recursive: true })
    assert(result)
})
