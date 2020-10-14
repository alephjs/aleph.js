import { version } from './version.ts';

const p = version.split('.').map(s => parseInt(s))
const versions = [
    `${p[0]}.${p[1]}.${p[2] + 1}`,
    `${p[0]}.${p[1] + 1}.0`,
    `${p[0] + 1}.0.0`,
]

async function ask(question: string = '', stdin = Deno.stdin, stdout = Deno.stdout) {
    const buf = new Uint8Array(1024)
    await stdout.write(new TextEncoder().encode(question))
    const n = <number>await stdin.read(buf)
    const answer = new TextDecoder().decode(buf.subarray(0, n))
    return answer.trim()
}

async function run(...cmd: string[]) {
    const p = Deno.run({
        cmd,
        stdout: 'piped',
        stderr: 'piped'
    })
    Deno.stdout.write(await p.output())
    Deno.stderr.write(await p.stderrOutput())
    p.close()
}

async function main() {
    const answer = await ask([...versions.map((v, i) => `${i + 1}. v${v}`), 'upgrade to: '].join('\n'))
    const v = parseInt(answer)
    if (!isNaN(v) && v > 0 && v <= 3) {
        const up = versions[v - 1]
        if (await ask('are you sure? (y/n) ') === 'y') {
            await Deno.writeTextFile('./version.ts', `export const version = '${up}'\n`)
            await run('git', 'add', '.', '--all')
            await run('git', 'commit', '-m', `v${up}`)
            await run('git', 'tag', `v${up}`)
        }
    }
}

if (import.meta.main) {
    main()
}
