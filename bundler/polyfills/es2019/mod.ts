import flatShim from 'https://esm.sh/array.prototype.flat/shim'
import flatMapShim from 'https://esm.sh/array.prototype.flatmap/shim'
import descriptionShim from 'https://esm.sh/symbol.prototype.description/shim'
import fromEntriesShim from 'https://esm.sh/object.fromentries/shim'
import trimStartShim from 'https://esm.sh/string.prototype.trimstart/shim'
import trimEndShim from 'https://esm.sh/string.prototype.trimend/shim'

import '../es2020/mod.ts'

flatShim()
flatMapShim()
descriptionShim()
fromEntriesShim()
trimStartShim()
trimEndShim()
