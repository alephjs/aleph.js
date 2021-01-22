import { mark, wrap } from 'https://esm.sh/regenerator-runtime@0.13.7'

if (!('regeneratorRuntime' in window)) {
  window.regeneratorRuntime = { mark, wrap }
}
