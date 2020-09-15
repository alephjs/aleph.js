import { ts } from '../deps.ts'
import transformImportPathRewrite from './transform-import-path-rewrite.ts'
import transformReactJsxSource from './transform-react-jsx-source.ts'
import transformReactRefresh from './transform-react-refresh.ts'
import { CreatePlainTransformer, CreateTransformer } from './transformer.ts'

export interface CompileOptions {
    target?: string
    mode?: 'development' | 'production'
    rewriteImportPath?: (importPath: string) => string
    reactRefresh?: boolean
    hmr?: { id: string }
}

export function createSourceFile(fileName: string, source: string) {
    return ts.createSourceFile(
        fileName,
        source,
        ts.ScriptTarget.ES2015,
    )
}

const allowTargets = [
    'esnext',
    'es5',
    'es2015',
    'es2016',
    'es2017',
    'es2018',
    'es2019',
    'es2020',
]

export function compile(fileName: string, source: string, { target: targetName = 'ES2015', mode, rewriteImportPath, reactRefresh, hmr }: CompileOptions) {
    const target = allowTargets.indexOf(targetName.toLowerCase())
    const transformers: ts.CustomTransformers = { before: [], after: [] }
    if (mode === 'development') {
        transformers.before!.push(CreatePlainTransformer(transformReactJsxSource))
    }
    if (reactRefresh) {
        transformers.before!.push(CreateTransformer(transformReactRefresh, { hmr }))
    }
    if (rewriteImportPath) {
        transformers.after!.push(CreatePlainTransformer(transformImportPathRewrite, rewriteImportPath))
    }

    return ts.transpileModule(source, {
        fileName,
        reportDiagnostics: true,
        compilerOptions: {
            target: target < 0 ? ts.ScriptTarget.ES2015 : (target || 99),
            module: ts.ModuleKind.ES2020,
            isolatedModules: true,
            allowJs: true,
            jsx: ts.JsxEmit.React,
            experimentalDecorators: true,
            importHelpers: true,
            importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
            alwaysStrict: true,
            sourceMap: true,
            inlineSources: true,
        },
        transformers,
    })
}
