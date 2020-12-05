import { mark, wrap } from 'https://esm.sh/regenerator-runtime@0.13.7'

window.require = function (name) {
  if (name === 'regenerator-runtime') {
    if ('regeneratorRuntime' in window) {
      return regeneratorRuntime
    }
    return { mark, wrap }
  } else {
    throw new Error(`module ${name} undefined`)
  }
}
