import ts from 'https://esm.sh/typescript'

export function CreatePlainTransformer(transform: (sf: ts.SourceFile, node: ts.Node, ...args: any[]) => ts.VisitResult<ts.Node>, ...args: any[]): ts.TransformerFactory<ts.SourceFile> {
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

export function CreateTransformer(transform: (ctx: ts.TransformationContext, sf: ts.SourceFile, options?: Record<string, any>) => ts.SourceFile, options?: Record<string, any>): ts.TransformerFactory<ts.SourceFile> {
    return ctx => sf => transform(ctx, sf, options)
}
