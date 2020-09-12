import { colors } from './deps.ts'

export default {
    debug(...args: unknown[]) {
        console.log(colorfulTag('debug', colors.blue), ...args)
    },
    info(...args: unknown[]) {
        console.log(colorfulTag('info', colors.green), ...args)
    },
    warn(...args: unknown[]) {
        console.log(colorfulTag('warn', colors.yellow), ...args)
    },
    error(...args: unknown[]) {
        console.log(colorfulTag('error', colors.red), ...args)
    }
}

function colorfulTag(tag: string, colorful: (text: string) => string) {
    return [colors.dim('['), colorful(tag), colors.dim(']')].join(' ')
}
