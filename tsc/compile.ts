import ts from 'https://esm.sh/typescript'
import transformImportPathRewrite from './transform-import-path-rewrite.ts'
import transformReactJsx from './transform-react-jsx.ts'
import transformReactRefresh from './transform-react-refresh.ts'
import transformReactUseDenoHook from './transform-react-use-deno-hook.ts'

export interface CompileOptions {
    mode: 'development' | 'production'
    target: string
    reactRefresh: boolean
    rewriteImportPath: (importPath: string, async?: boolean) => string
    signUseDeno: (id: string) => string
}

const allowTargets = [
    'esnext',
    'es2015',
    'es2016',
    'es2017',
    'es2018',
    'es2019',
    'es2020',
]

export function compile(fileName: string, source: string, { mode, target: targetName, rewriteImportPath, reactRefresh, signUseDeno }: CompileOptions) {
    const target = allowTargets.indexOf(targetName.toLowerCase())
    const transformers: ts.CustomTransformers = { before: [], after: [] }
    transformers.before!.push(createPlainTransformer(transformReactJsx, { mode, rewriteImportPath }))
    transformers.before!.push(createTransformer(transformReactUseDenoHook, signUseDeno))
    if (reactRefresh) {
        transformers.before!.push(createTransformer(transformReactRefresh))
    }
    transformers.after!.push(createPlainTransformer(transformImportPathRewrite, rewriteImportPath))

    return ts.transpileModule(source, {
        fileName,
        reportDiagnostics: true,
        compilerOptions: {
            target: target < 0 ? ts.ScriptTarget.ES2015 : (target > 0 ? target + 1 : 99),
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

function createPlainTransformer(transform: (sf: ts.SourceFile, node: ts.Node, ...args: any[]) => ts.VisitResult<ts.Node>, ...args: any[]): ts.TransformerFactory<ts.SourceFile> {
    function nodeVisitor(ctx: ts.TransformationContext, sf: ts.SourceFile) {
        const visitor: ts.Visitor = node => {
            const ret = transform(sf, node, ...args)
            if (ret != null) {
                return ret
            }
            return ts.visitEachChild(node, visitor, ctx)
        }
        return visitor
    }

    return ctx => sf => ts.visitNode(sf, nodeVisitor(ctx, sf))
}

function createTransformer(transform: (ctx: ts.TransformationContext, sf: ts.SourceFile, options?: any) => ts.SourceFile, options?: Record<string, any>): ts.TransformerFactory<ts.SourceFile> {
    return ctx => sf => transform(ctx, sf, options)
}
