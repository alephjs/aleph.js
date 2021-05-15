import '../es2018/mod.ts'

// Object.values/Object.entries are stage 4, in ES2017
// Copied from https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/entries
if (!Object.values) {
  Object.values = function values(obj) {
    var ownProps = Object.keys(obj),
      i = ownProps.length,
      resArray = new Array(i) // preallocate the Array
    while (i--)
      resArray[i] = obj[ownProps[i]]

    return resArray
  }
}

if (!Object.entries) {
  Object.entries = function (obj) {
    var ownProps = Object.keys(obj),
      i = ownProps.length,
      resArray = new Array(i) // preallocate the Array
    while (i--)
      resArray[i] = [ownProps[i], obj[ownProps[i]]]

    return resArray
  }
}

// String#padStart/String#padEnd are stage 4, in ES2017
// Copied from https://github.com/behnammodi/polyfill/blob/master/string.polyfill.js
if (!String.prototype.padStart) {
  Object.defineProperty(String.prototype, 'padStart', {
    configurable: true,
    writable: true,
    value: function (targetLength, padString) {
      targetLength = targetLength >> 0 //floor if number or convert non-number to 0;
      padString = String(typeof padString !== 'undefined' ? padString : ' ')
      if (this.length > targetLength) {
        return String(this)
      } else {
        targetLength = targetLength - this.length
        if (targetLength > padString.length) {
          padString += padString.repeat(targetLength / padString.length) //append to original to ensure we are longer than needed
        }
        return padString.slice(0, targetLength) + String(this)
      }
    },
  })
}
if (!String.prototype.padEnd) {
  Object.defineProperty(String.prototype, 'padEnd', {
    configurable: true,
    writable: true,
    value: function (targetLength, padString) {
      targetLength = targetLength >> 0 //floor if number or convert non-number to 0;
      padString = String(typeof padString !== 'undefined' ? padString : ' ')
      if (this.length > targetLength) {
        return String(this)
      } else {
        targetLength = targetLength - this.length
        if (targetLength > padString.length) {
          padString += padString.repeat(targetLength / padString.length) //append to original to ensure we are longer than needed
        }
        return String(this) + padString.slice(0, targetLength)
      }
    },
  })
}

// Object.getOwnPropertyDescriptors is stage 4, in ES2017
// Copied from https://github.com/watson/get-own-property-descriptors-polyfill/blob/master/index.js
// Licensed MIT
if (!Object.getOwnPropertyDescriptors) {
  Object.getOwnPropertyDescriptors = function (obj) {
    if (obj === null || obj === undefined) {
      throw new TypeError('Cannot convert undefined or null to object')
    }

    const protoPropDescriptor = Object.getOwnPropertyDescriptor(obj, '__proto__')
    const descriptors = protoPropDescriptor ? { ['__proto__']: protoPropDescriptor } : {}

    for (const name of Object.getOwnPropertyNames(obj)) {
      descriptors[name] = Object.getOwnPropertyDescriptor(obj, name)
    }

    return descriptors
  }
}
