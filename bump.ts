import { version } from './version.ts';

const [major, minor, patch] = version.split('.').map(s => parseInt(s))
const versions = [
    `${major}.${minor}.${patch + 1}`,
    `${major}.${minor + 1}.0`,
    `${major + 1}.0.0`,
]

async function ask(question: string = ':', stdin = Deno.stdin, stdout = Deno.stdout) {
    const buf = new Uint8Array(1024)
    await stdout.write(new TextEncoder().encode(question + ' '))
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
    const answer = await ask([...versions.map((v, i) => `${i + 1} → v${v}`), 'upgrade to:'].join('\n'))
    const n = parseInt(answer)
    if (!isNaN(n) && n > 0 && n <= versions.length) {
        const up = versions[n - 1]
        if (/y(es)?/i.test(await ask('are you sure? (y/n)'))) {
            await Deno.writeTextFile('./version.ts', `export const version = '${up}'\n`)
            await run('git', 'add', '.', '--all')
            await run('git', 'commit', '-m', `v${up}`)
            await run('git', 'tag', `v${up}`)
            await run('git', 'push', 'origin', 'master', '--tag', `v${up}`)
        }
    }
}

if (import.meta.main) {
    main()
}
