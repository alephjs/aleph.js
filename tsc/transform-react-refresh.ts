/**
 * TypeScript AST Transformer for react refresh.
 * @link https://github.com/facebook/react/issues/16604#issuecomment-528663101
 * @link https://github.com/facebook/react/blob/master/packages/react-refresh/src/ReactFreshBabelPlugin.js
 */

// @deno-types="../vendor/typescript/lib/typescript.d.ts"
import ts from '../vendor/typescript/lib/typescript.js'

type TSFunctionLike = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction

export class RefreshTransformer {
    private _sf: ts.SourceFile

    static refreshSig = '$RefreshSig$'
    static refreshReg = '$RefreshReg$'

    constructor(sf: ts.SourceFile) {
        this._sf = sf
    }

    transform() {
        const statements: ts.Statement[] = []
        const components: ts.Identifier[] = []
        const signatures: ts.Identifier[] = []
        const hookCalls: WeakMap<TSFunctionLike, { id: ts.Identifier, key: string, customHooks: string[] }> = new WeakMap()
        const seenHooks: Set<string> = new Set()
        this._sf.statements.forEach(node => {
            if (ts.isFunctionDeclaration(node)) {
                const hookCallsSignature = this._getHookCallsSignature(node)
                if (node.name && isComponentishName(node.name.text)) {
                    components.push(node.name)
                }
                if (node.name && isHookName(node.name.text)) {
                    seenHooks.add(node.name.text)
                }
                if (hookCallsSignature) {
                    const id = ts.createUniqueName('_s', ts.GeneratedIdentifierFlags.Optimistic)
                    signatures.push(id)
                    hookCalls.set(node, { id, ...hookCallsSignature })
                }
            } else if (ts.isVariableStatement(node)) {
                node.declarationList.declarations.forEach(({ name, initializer }) => {
                    if (
                        initializer &&
                        ts.isIdentifier(name) &&
                        (ts.isFunctionExpression(initializer) || ts.isArrowFunction(initializer))
                    ) {
                        const hookCallsSignature = this._getHookCallsSignature(initializer)
                        if (isComponentishName(name.text)) {
                            components.push(name)
                        }
                        if (isHookName(name.text)) {
                            seenHooks.add(name.text)
                        }
                        if (hookCallsSignature) {
                            const id = ts.createUniqueName('_s', ts.GeneratedIdentifierFlags.Optimistic)
                            signatures.push(id)
                            hookCalls.set(initializer, { id, ...hookCallsSignature })
                        }
                    }
                })
            } else if (ts.isImportDeclaration(node)) {
                const name = node.importClause?.name
                const namedBindings = node.importClause?.namedBindings
                if (name && isHookName(name.text)) {
                    seenHooks.add(name.text)
                }
                if (namedBindings) {
                    namedBindings.forEachChild(node => {
                        if (ts.isImportSpecifier(node) && isHookName(node.name.text)) {
                            seenHooks.add(node.name.text)
                        }
                    })
                }
            }
            statements.push(node)
        })

        components.forEach(name => {
            statements.push(ts.createExpressionStatement(
                ts.createCall(
                    ts.createIdentifier(RefreshTransformer.refreshReg),
                    undefined,
                    [
                        name,
                        ts.createStringLiteralFromNode(name)
                    ]
                )
            ))
        })

        if (signatures.length > 0) {
            statements.unshift(ts.createVariableStatement(
                undefined,
                ts.createVariableDeclarationList(signatures.map(id => {
                    return ts.createVariableDeclaration(
                        id,
                        undefined,
                        ts.createCall(ts.createIdentifier(RefreshTransformer.refreshSig), undefined, undefined)
                    )
                }), ts.NodeFlags.Const)
            ))
        }

        return ts.updateSourceFileNode(
            this._sf,
            ts.setTextRange(
                ts.createNodeArray(
                    statements.map(node => {
                        if (ts.isFunctionDeclaration(node) && hookCalls.has(node)) {
                            const { id, key, customHooks } = hookCalls.get(node)!
                            const _customHooks = customHooks.filter(name => seenHooks.has(name))
                            const forceResetComment = !!ts.getLeadingCommentRanges(this._sf.text, node.pos)?.filter(({ pos, end }) => this._sf.text.substring(pos, end).includes('@refresh reset')).length;
                            return this._sign(node, node.name!.text, id, key, forceResetComment || _customHooks.length !== _customHooks.length, _customHooks)! as ts.Statement[]
                        }
                        if (ts.isVariableStatement(node)) {
                            const forceResetComment = !!ts.getLeadingCommentRanges(this._sf.text, node.pos)?.filter(({ pos, end }) => this._sf.text.substring(pos, end).includes('@refresh reset')).length;
                            const _ss: ts.Statement[] = []
                            const vs = ts.createVariableStatement(
                                node.modifiers,
                                ts.createVariableDeclarationList(
                                    node.declarationList.declarations.map(decl => {
                                        const { name, initializer } = decl
                                        if (
                                            initializer &&
                                            ts.isIdentifier(name) &&
                                            (ts.isFunctionExpression(initializer) || ts.isArrowFunction(initializer)) &&
                                            hookCalls.has(initializer)
                                        ) {
                                            const { id, key, customHooks } = hookCalls.get(initializer)!
                                            const _customHooks = customHooks.filter(name => seenHooks.has(name))
                                            const [_initializer, _s] = this._sign(initializer, name.text, id, key, forceResetComment || _customHooks.length !== _customHooks.length, _customHooks)!
                                            _ss.push(_s as ts.Statement)
                                            return ts.createVariableDeclaration(name, decl.type, _initializer as ts.ArrowFunction)
                                        }
                                        return decl
                                    }),
                                    node.declarationList.flags
                                )
                            )
                            return [vs, ..._ss]
                        }
                        return node
                    }).flat()
                ),
                this._sf.statements
            )
        )
    }

    private _getHookCallsSignature(fnNode: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction) {
        const hookCalls: { name: string, key: string }[] = []
        if (fnNode.body && ts.isBlock(fnNode.body)) {
            fnNode.body.statements.forEach(s => {
                if (ts.isVariableStatement(s)) {
                    s.declarationList.declarations.forEach(({ name, initializer }) => {
                        if (
                            initializer &&
                            ts.isCallExpression(initializer)
                        ) {
                            const sig = this._getHookCallSignature(initializer)
                            if (sig) {
                                hookCalls.push(sig)
                            }
                        }
                    })
                } else if (
                    ts.isExpressionStatement(s) &&
                    ts.isCallExpression(s.expression)
                ) {
                    const sig = this._getHookCallSignature(s.expression)
                    if (sig) {
                        hookCalls.push(sig)
                    }
                }
            })
        }
        if (hookCalls.length === 0) {
            return null
        }
        return {
            key: hookCalls.map(call => call.name + '{' + call.key + '}').join('\n'),
            customHooks: hookCalls
                .filter(call => !isBuiltinHook(call.name))
                .map(call => call.name),
        }
    }

    private _getHookCallSignature(ctx: ts.CallExpression) {
        let name: string
        const { expression, arguments: args } = ctx
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

        let key = ''
        if (ts.isVariableDeclaration(ctx.parent)) {
            // TODO: if there is no LHS, consider some other heuristic.
            key = ctx.parent.name.getText()
        }

        // Some built-in Hooks reset on edits to arguments.
        if (name === 'useState' && args.length > 0) {
            // useState second argument is initial state.
            key += '(' + args[0].getText() + ')'
        } else if (name === 'useReducer' && args.length > 1) {
            // useReducer second argument is initial state.
            key += '(' + args[1].getText() + ')'
        }

        return {
            name,
            key,
        }
    }

    private _sign(fnNode: TSFunctionLike, fnName: string, sigId: ts.Identifier, key: string, forceReset: boolean, customHooks: string[]) {
        if (fnNode.body && ts.isBlock(fnNode.body)) {
            const _s = ts.createExpressionStatement(ts.createCall(
                sigId,
                undefined,
                [
                    ts.createIdentifier(fnName),
                    ts.createStringLiteral(key),
                    ...(forceReset || customHooks.length > 0 ? [
                        forceReset ? ts.createTrue() : ts.createFalse(),
                        ...(customHooks.length > 0 ? [
                            ts.createFunctionExpression(
                                undefined,
                                undefined,
                                undefined,
                                undefined,
                                undefined,
                                undefined,
                                ts.createBlock([
                                    ts.createReturn(
                                        ts.createArrayLiteral(
                                            customHooks.map(name => ts.createIdentifier(name)),
                                            false
                                        )
                                    )
                                ], true)
                            )
                        ] : [])
                    ] : [])
                ]
            ))
            if (ts.isFunctionDeclaration(fnNode)) {
                return [
                    ts.createFunctionDeclaration(
                        fnNode.decorators,
                        fnNode.modifiers,
                        fnNode.asteriskToken,
                        fnNode.name,
                        fnNode.typeParameters,
                        fnNode.parameters,
                        fnNode.type,
                        ts.createBlock([
                            ts.createExpressionStatement(ts.createCall(sigId, undefined, undefined)),
                            ...fnNode.body.statements
                        ], true)
                    ),
                    _s
                ]
            } else if (ts.isFunctionExpression(fnNode)) {
                return [
                    ts.createFunctionExpression(
                        fnNode.modifiers,
                        fnNode.asteriskToken,
                        fnNode.name,
                        fnNode.typeParameters,
                        fnNode.parameters,
                        fnNode.type,
                        ts.createBlock([
                            ts.createExpressionStatement(ts.createCall(sigId, undefined, undefined)),
                            ...fnNode.body.statements
                        ], true)
                    ),
                    _s
                ]
            } else if (ts.isArrowFunction(fnNode)) {
                return [
                    ts.createArrowFunction(
                        fnNode.modifiers,
                        fnNode.typeParameters,
                        fnNode.parameters,
                        fnNode.type,
                        ts.createBlock([
                            ts.createExpressionStatement(ts.createCall(sigId, undefined, undefined)),
                            ...fnNode.body.statements
                        ], true)
                    ),
                    _s
                ]
            }
        }
    }
}

function isComponentishName(name: string) {
    const c = name.charAt(0)
    return c >= 'A' && c <= 'Z'
}

function isHookName(name: string) {
    let c: string
    return name.startsWith('use') && (c = name.charAt(3)) && c >= 'A' && c <= 'Z'
}

function isBuiltinHook(hookName: string) {
    switch (hookName) {
        case 'useState':
        case 'React.useState':
        case 'useReducer':
        case 'React.useReducer':
        case 'useEffect':
        case 'React.useEffect':
        case 'useLayoutEffect':
        case 'React.useLayoutEffect':
        case 'useMemo':
        case 'React.useMemo':
        case 'useCallback':
        case 'React.useCallback':
        case 'useRef':
        case 'React.useRef':
        case 'useContext':
        case 'React.useContext':
        case 'useImperativeMethods':
        case 'React.useImperativeMethods':
        case 'useDebugValue':
        case 'React.useDebugValue':
            return true;
        default:
            return false;
    }
}

export default function transformReactRefresh(ctx: ts.TransformationContext, sf: ts.SourceFile): ts.SourceFile {
    const t = new RefreshTransformer(sf)
    return t.transform()
}
