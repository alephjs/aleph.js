import matchallShim from 'https://esm.sh/string.prototype.matchall/shim'
import globalthisShim from 'https://esm.sh/globalthis/shim'
import allsettledShim from 'https://esm.sh/promise.allsettled/shim'
import '../es2021/mod.ts'

matchallShim()
globalthisShim()
allsettledShim()
