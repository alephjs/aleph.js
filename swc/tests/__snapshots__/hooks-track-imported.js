var _a;
var _b;
_b = $RefreshSig$();
// ? should track custom hooks
import { useImport } from 'path';
import useImportDefault from 'path';
import { a as useAliasImport } from 'path';
import ReactUse from 'react-use';
import * as all from 'react-use';
function App() {
    _b();
    useImport(useImportDefault(useAliasImport(ReactUse.useTimer(all.useA()))));
}
_a = App;
$RefreshReg$(_a, "App");
_b(App, `useImport{}
useImportDefault{}
useAliasImport{}
ReactUse.useTimer{}
all.useA{}`, false, () => [useImport, useImportDefault, useAliasImport, ReactUse.useTimer, all.useA]);
