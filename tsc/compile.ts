// @deno-types="../vendor/typescript/lib/typescript.d.ts"
import ts from '../vendor/typescript/lib/typescript.js'
import transformImportPathRewrite from './transform-import-path-rewrite.ts'
import transformReactJsxSource from './transform-react-jsx-source.ts'
import transformReactRefresh from './transform-react-refresh.ts'
import { CreatePlainTransformer, CreateTransformer } from './transformer.ts'

export interface CompileOptions {
    target?: 'ES2015' | 'ES2016' | 'ES2017' | 'ES2018' | 'ES2019' | 'ES2020' | 'ESNext'
    mode?: 'development' | 'production'
    rewriteImportPath?: (importPath: string) => string
    reactRefresh?: boolean
    transformers?: (ts.TransformerFactory<ts.SourceFile> | ts.CustomTransformerFactory)[]
}

export function createSourceFile(fileName: string, source: string) {
    return ts.createSourceFile(
        fileName,
        source,
        ts.ScriptTarget.ES2015,
    )
}

export function compile(fileName: string, source: string, { target: targetName = 'ES2015', mode, rewriteImportPath, reactRefresh }: CompileOptions) {
    const target = ['esnext', 'es2015', 'es2016', 'es2017', 'es2018', 'es2019', 'es2020'].indexOf(targetName.toLowerCase())
    const transformers: ts.CustomTransformers = {
        before: [],
        after: []
    }
    if (mode === 'development') {
        transformers.before!.push(CreatePlainTransformer(transformReactJsxSource))
    }
    if (rewriteImportPath) {
        transformers.after!.push(CreatePlainTransformer(transformImportPathRewrite, rewriteImportPath))
    }
    if (reactRefresh) {
        transformers.after!.push(CreateTransformer(transformReactRefresh))
    }

    return ts.transpileModule(source, {
        fileName,
        reportDiagnostics: true,
        compilerOptions: {
            target: target < 0 ? ts.ScriptTarget.ES2015 : (target ? target + 1 : 99),
            module: ts.ModuleKind.ES2020,
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
