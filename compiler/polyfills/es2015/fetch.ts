import * as Fetch from 'https://esm.sh/whatwg-fetch@3.6.1'

if (!('fetch' in window)) {
  Object.assign(window, Fetch)
}
