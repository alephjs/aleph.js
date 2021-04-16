import flatShim from 'https://esm.sh/array.prototype.flat/shim'
import flatmapShim from 'https://esm.sh/array.prototype.flatmap/shim'
import descriptionShim from 'https://esm.sh/symbol.prototype.description/shim'
import fromentriesShim from 'https://esm.sh/object.fromentries/shim'
import '../es2020/mod.ts'

flatShim()
flatmapShim()
descriptionShim()
fromentriesShim()
