import { colors } from '../deps.ts'

export type LevelNames = 'debug' | 'info' | 'warn' | 'error' | 'fatal'

export enum Level {
  Debug = 0,
  Info = 1,
  Warn = 2,
  Error = 3,
  Fatal = 4,
}

export class Logger {
  #level: Level = Level.Info

  setLevel(level: LevelNames) {
    switch (level) {
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
      console.log(colors.blue('DEBUG'), ...args)
    }
  }

  info(...args: unknown[]) {
    if (this.#level <= Level.Info) {
      console.log(colors.green('INFO'), ...args)
    }
  }

  warn(...args: unknown[]) {
    if (this.#level <= Level.Warn) {
      console.log(colors.yellow('WARN'), ...args)
    }
  }

  error(...args: unknown[]) {
    if (this.#level <= Level.Error) {
      console.log(colors.red('ERROR'), ...args)
    }
  }

  fatal(...args: unknown[]) {
    if (this.#level <= Level.Fatal) {
      console.log(colors.red('FATAL'), ...args)
      Deno.exit(1)
    }
  }
}

export default new Logger()
