/**
 * TypeScript AST Transformer for useDeno hook.
 */

import ts from 'https://esm.sh/typescript@4.1.2'

const f = ts.factory

export default function transformReactUseDenoHook(sf: ts.SourceFile, node: ts.Node, options: { index: number, signUseDeno: (id: string) => string }): ts.VisitResult<ts.Node> {
    if (isUseDenoHookCallExpr(node)) {
        const args = node.arguments as unknown as Array<any>
        const id = options.signUseDeno(`${sf.fileName}:useDeno#${options.index++}`)
        const arg3 = f.createStringLiteral(id)
        if (args.length === 1) {
            args.push(f.createFalse())
        }
        if (args.length === 2) {
            args.push(f.createVoidZero())
        }
        if (args.length === 3) {
            args.push(arg3)
        } else {
            args[3] = arg3
        }
        return node
    }
}

function isUseDenoHookCallExpr(node: ts.Node): node is ts.CallExpression {
    if (ts.isCallExpression(node)) {
        const { expression, arguments: [arg0] } = node
        if (ts.isFunctionLike(arg0)) {
            if (ts.isIdentifier(expression)) {
                return expression.text === 'useDeno'
            } else if (ts.isPropertyAccessExpression(expression)) {
                return expression.name.text === 'useDeno'
            }
        }
    }
    return false
}
