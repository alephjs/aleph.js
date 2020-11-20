// ? should track custom hooks

import { useImport } from 'path'
import useImportDefault from 'path'
import { a as useAliasImport } from 'path'
import ReactUse from 'react-use'
import * as all from 'react-use'
function App() {
    useImport(useImportDefault(useAliasImport(ReactUse.useTimer(all.useA()))))
}
