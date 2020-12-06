import ts from 'https://esm.sh/typescript@4.1.2'

/**
 * TS AST transformer to rewrite import path.
 *
 * @link https://github.com/dropbox/ts-transform-import-path-rewrite
 */
export default function transformImportPathRewrite(sf: ts.SourceFile, node: ts.Node, rewriteImportPath: (importPath: string) => string): ts.VisitResult<ts.Node> {
    let importPath = ''
    if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier
    ) {
        const importPathWithQuotes = node.moduleSpecifier.getText(sf)
        importPath = importPathWithQuotes.substr(1, importPathWithQuotes.length - 2)
    } else if (isDynamicImport(node)) {
        const arg0 = node.arguments[0]
        if (ts.isStringLiteral(arg0)) {
            const importPathWithQuotes = arg0.getText(sf)
            importPath = importPathWithQuotes.substr(1, importPathWithQuotes.length - 2)
        }
    } else if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteral(node.argument.literal)
    ) {
        // `.text` instead of `getText` bc this node doesn't map to sf (it's generated d.ts)
        importPath = node.argument.literal.text
    }

    if (importPath) {
        const rewrittenPath = rewriteImportPath(importPath)
        if (rewrittenPath !== importPath) {
            const newNode = ts.getMutableClone(node)
            if (ts.isImportDeclaration(newNode) || ts.isExportDeclaration(newNode)) {
                Object.assign(newNode, { moduleSpecifier: ts.createLiteral(rewrittenPath) })
            } else if (isDynamicImport(newNode)) {
                Object.assign(newNode, { arguments: ts.createNodeArray([ts.createStringLiteral(rewrittenPath)]) })
            } else if (ts.isImportTypeNode(newNode)) {
                Object.assign(newNode, { argument: ts.createLiteralTypeNode(ts.createStringLiteral(rewrittenPath)) })
            }
            return newNode
        }
    }
}

function isDynamicImport(node: ts.Node): node is ts.CallExpression {
    return ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
}
