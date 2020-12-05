import * as regenerator_runtime from "https://esm.sh/regenerator-runtime@0.13.7"
__ALEPH.pack["regenerator-runtime"] = regenerator_runtime

window.require = function(name) {
  if (name === "regenerator-runtime") {
    return __ALEPH.pack["regenerator-runtime"]
  } else {
    throw new Error(`module ${name} undefined`)
  }
}
