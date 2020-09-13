import { colors } from './deps.ts'

enum Level {
    Debug = 0,
    Info = 1,
    Warn = 2,
    Error = 3,
}

class Logger {
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
        }
    }

    debug(...args: unknown[]) {
        if (this.#level <= Level.Debug) {
            console.log(this._colorfulTag('debug', colors.blue), ...args)
        }
    }

    info(...args: unknown[]) {
        if (this.#level <= Level.Info) {
            console.log(this._colorfulTag('info', colors.green), ...args)
        }
    }

    warn(...args: unknown[]) {
        if (this.#level <= Level.Warn) {
            console.log(this._colorfulTag('warn', colors.yellow), ...args)
        }
    }

    error(...args: unknown[]) {
        if (this.#level <= Level.Error) {
            console.log(this._colorfulTag('error', colors.red), ...args)
        }
    }

    private _colorfulTag(tag: string, colorful: (text: string) => string) {
        return [colors.dim('['), colorful(tag), colors.dim(']')].join(' ')
    }
}

export default new Logger()

