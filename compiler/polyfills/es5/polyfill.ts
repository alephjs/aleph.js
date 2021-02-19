import regeneratorRuntime from 'https://esm.sh/regenerator-runtime@0.13.7'
import * as Fetch from 'https://esm.sh/whatwg-fetch@3.6.1'

if (!('regeneratorRuntime' in window)) {
  Object.assign(window, { regeneratorRuntime })
}

if (!('fetch' in window)) {
  Object.assign(window, Fetch)
}
