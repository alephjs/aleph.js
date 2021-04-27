import '../es2019/mod.ts'

import finallyShim from 'https://esm.sh/promise.prototype.finally/shim'

if (typeof Promise === 'function') {
  finallyShim()
}
