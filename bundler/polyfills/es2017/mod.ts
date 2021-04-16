// Object.values/Object.entries are stage 4, in ES2017
import valuesShim from 'https://esm.sh/object.values/shim'
import entriesShim from 'https://esm.sh/object.entries/shim'

// String#padStart/String#padEnd are stage 4, in ES2017
import padstartShim from 'https://esm.sh/string.prototype.padstart/shim'
import padendShim from 'https://esm.sh/string.prototype.padend/shim'

// Object.getOwnPropertyDescriptors is stage 4, in ES2017
import getownpropertydescriptorsShim from 'https://esm.sh/object.getownpropertydescriptors/shim'

import '../es2018/mod.ts'

valuesShim()
entriesShim()
padstartShim()
padendShim()
getownpropertydescriptorsShim()
