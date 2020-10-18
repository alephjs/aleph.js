/**
 * TypeScript AST Transformer for react refresh.
 * @link https://github.com/facebook/react/issues/16604#issuecomment-528663101
 * @link https://github.com/facebook/react/blob/master/packages/react-refresh/src/ReactFreshBabelPlugin.js
 */

import ts from 'https://esm.sh/typescript'
import { isHookName } from './transform-react-refresh.ts'

const f = ts.factory

export class RefreshTransformer {
    #sf: ts.SourceFile
    #useDenoIndex: number
    #signUseDeno: (id: string) => string

    constructor(sf: ts.SourceFile, signUseDeno: (id: string) => string) {
        this.#sf = sf
        this.#useDenoIndex = 0
        this.#signUseDeno = signUseDeno
    }

    transform() {
        const statements: ts.Statement[] = []

        this.#sf.statements.forEach(node => {
            if (ts.isFunctionDeclaration(node)) {
                this._getHookCallsSignature(node)
            } else if (ts.isVariableStatement(node)) {
                node.declarationList.declarations.forEach(({ name, initializer, modifiers }) => {
                    if (
                        initializer &&
                        ts.isIdentifier(name) &&
                        (ts.isFunctionExpression(initializer) || ts.isArrowFunction(initializer))
                    ) {
                        this._getHookCallsSignature(initializer)
                    }
                })
            }
            statements.push(node)
        })

        return ts.updateSourceFileNode(
            this.#sf,
            ts.setTextRange(
                f.createNodeArray(statements),
                this.#sf.statements
            )
        )
    }

    private _getHookCallsSignature(fnNode: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction) {
        if (fnNode.body && ts.isBlock(fnNode.body)) {
            fnNode.body.statements.forEach(s => {
                if (ts.isVariableStatement(s)) {
                    s.declarationList.declarations.forEach(({ initializer }) => {
                        if (
                            initializer &&
                            ts.isCallExpression(initializer)
                        ) {
                            const name = this._getHookCallSignature(initializer)
                            if (name === 'useDeno') {
                                this._signUseDeno(initializer)
                            }
                        }
                    })
                } else if (
                    ts.isExpressionStatement(s) &&
                    ts.isCallExpression(s.expression)
                ) {
                    const name = this._getHookCallSignature(s.expression)
                    if (name === 'useDeno') {
                        this._signUseDeno(s.expression)
                    }
                }
            })
        }
    }

    private _getHookCallSignature(ctx: ts.CallExpression) {
        let name: string
        const { expression } = ctx
        if (ts.isIdentifier(expression)) {
            name = expression.text
        } else if (ts.isPropertyAccessExpression(expression)) {
            name = expression.name.text
        } else {
            return null
        }
        if (!isHookName(name)) {
            return null
        }
        return name
    }

    private _signUseDeno(call: ts.CallExpression) {
        const args = call.arguments as unknown as Array<any>
        if (args.length > 0) {
            const id = this.#signUseDeno(this.#sf.fileName + ':useDeno#' + (this.#useDenoIndex++))
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
        }
    }
}



export default function transformReactUseDenoHook(ctx: ts.TransformationContext, sf: ts.SourceFile, signUseDeno: (id: string) => string): ts.SourceFile {
    const t = new RefreshTransformer(sf, signUseDeno)
    return t.transform()
}
