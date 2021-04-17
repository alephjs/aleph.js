import finallyShim from 'https://esm.sh/promise.prototype.finally/shim'
import '../es2019/mod.ts'

if (typeof Promise === 'function') {
  finallyShim()
}
