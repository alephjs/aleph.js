import '../es2021/mod.ts'

// todo: add string.prototype.matchall shim

// globalThis
// Copied from https://mathiasbynens.be/notes/globalthis
if (typeof globalThis !== 'object') {
  Object.defineProperty(Object.prototype, '__magic__', {
    get: function () {
      return this
    },
    configurable: true // This makes it possible to `delete` the getter later.
  })
  __magic__.globalThis = __magic__ // lolwat
  delete Object.prototype.__magic__
}

// Promise.allSettled
if (!Promise.allSettled) {
  Promise.allSettled = (promises) => Promise.all(promises.map(p => p
    .then(value => ({
      status: 'fulfilled',
      value,
    }))
    .catch(reason => ({
      status: 'rejected',
      reason,
    }))
  ))
}
