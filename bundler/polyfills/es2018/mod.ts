import '../es2019/mod.ts'

/**
 * Available in:
 * Edge: 18
 * Firefox: 58
 * Chrome: 63
 * Safari: 11.1
 *
 * https://caniuse.com/promise-finally
 */
// Copied from https://github.com/vercel/next.js/blob/canary/packages/next-polyfill-module/src/index.js
// Licensed MIT
if (!Promise.prototype.finally) {
  Promise.prototype.finally = function (callback) {
    if (typeof callback !== 'function') {
      return this.then(callback, callback)
    }

    var P = this.constructor || Promise
    return this.then(
      function (value) {
        return P.resolve(callback()).then(function () {
          return value
        })
      },
      function (err) {
        return P.resolve(callback()).then(function () {
          throw err
        })
      }
    )
  }
}
