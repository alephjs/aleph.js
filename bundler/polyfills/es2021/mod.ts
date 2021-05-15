// String.prototype.replaceAll() polyfill
// Copied from https://gomakethings.com/how-to-replace-a-section-of-a-string-with-another-one-with-vanilla-js/
// Licensed MIT
if (!String.prototype.replaceAll) {
  String.prototype.replaceAll = function (str, newStr) {

    // If a regex pattern
    if (Object.prototype.toString.call(str).toLowerCase() === '[object regexp]') {
      return this.replace(str, newStr)
    }

    // If a string
    return this.replace(new RegExp(str, 'g'), newStr)

  }
}

/**
 * An implementation of the upcoming `Promise.any` functionality.
 *
 * @author Trevor Sears <trevorsears.main@gmail.com>
 * @version v0.1.0
 * @since v0.1.0
 */
if (!Promise.any) {
  Promise.any = async (values) => {

    return new Promise((resolve, reject) => {

      let hasResolved = false
      let iterableCount = 0
      let rejectionReasons = []

      const resolveOnce = (value) => {
        if (!hasResolved) {
          hasResolved = true
          resolve(value)
        }
      }
      const rejectionCheck = (reason) => {
        rejectionReasons.push(reason)
        if (rejectionReasons.length >= iterableCount) reject(rejectionReasons)
      }
      for (let value of values) {
        iterableCount++
        if ((value).then !== undefined) {
          let promiseLikeValue = value
          promiseLikeValue.then((result) => resolveOnce(result))
          if ((value).catch !== undefined) {
            let promiseValue = promiseLikeValue
            promiseValue.catch((reason) => rejectionCheck(reason))
          }
        }
      }
    })
  }
}
