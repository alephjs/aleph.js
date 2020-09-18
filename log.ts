import { colors } from './deps.ts'

export enum Level {
    Debug = 0,
    Info = 1,
    Warn = 2,
    Error = 3,
    Fatal = 4,
}

export class Logger {
    #level: Level = Level.Info

    setLevel(level: string) {
        switch (level.toLowerCase()) {
            case 'debug':
                this.#level = Level.Debug
                break
            case 'info':
                this.#level = Level.Info
                break
            case 'warn':
                this.#level = Level.Warn
                break
            case 'error':
                this.#level = Level.Error
                break
            case 'fatal':
                this.#level = Level.Fatal
                break
        }
    }

    debug(...args: unknown[]) {
        if (this.#level <= Level.Debug) {
            console.log(colorfulTag('debug', colors.blue), ...args)
        }
    }

    info(...args: unknown[]) {
        if (this.#level <= Level.Info) {
            console.log(colorfulTag('info', colors.green), ...args)
        }
    }

    warn(...args: unknown[]) {
        if (this.#level <= Level.Warn) {
            console.log(colorfulTag('warn', colors.yellow), ...args)
        }
    }

    error(...args: unknown[]) {
        if (this.#level <= Level.Error) {
            console.log(colorfulTag('error', colors.red), ...args)
        }
    }

    fatal(...args: unknown[]) {
        if (this.#level <= Level.Fatal) {
            console.log(colorfulTag('fatal', colors.red), ...args)
            Deno.exit(1)
        }
    }
}

function colorfulTag(tag: string, colorful: (text: string) => string) {
    return [colors.dim('['), colorful(tag), colors.dim(']')].join(' ')
}

export default new Logger()
