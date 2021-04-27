import '../es2018/mod.ts'

// Object.values/Object.entries are stage 4, in ES2017
import valuesShim from 'https://esm.sh/object.values/shim'
import entriesShim from 'https://esm.sh/object.entries/shim'

// String#padStart/String#padEnd are stage 4, in ES2017
import padStartShim from 'https://esm.sh/string.prototype.padstart/shim'
import padEndShim from 'https://esm.sh/string.prototype.padend/shim'

// Object.getOwnPropertyDescriptors is stage 4, in ES2017
import getOwnPropertyDescriptorsShim from 'https://esm.sh/object.getownpropertydescriptors/shim'

valuesShim()
entriesShim()
padStartShim()
padEndShim()
getOwnPropertyDescriptorsShim()
