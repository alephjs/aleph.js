import ts from 'https://esm.sh/typescript'

/**
 * TypeScript AST Transformer that adds source file and line number to JSX elements.
 *
 * @link https://github.com/dropbox/ts-transform-react-jsx-source
 */
export default function transformReactJsxSource(sf: ts.SourceFile, node: ts.Node): ts.VisitResult<ts.Node> {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const fileNameAttr = ts.createPropertyAssignment(
            'fileName',
            ts.createStringLiteral(sf.fileName)
        )
        const lineNumberAttr = ts.createPropertyAssignment(
            'lineNumber',
            ts.createNumericLiteral((sf.getLineAndCharacterOfPosition(node.pos).line + 1).toString())
        )
        const sourceJsxAttr = ts.createJsxAttribute(
            ts.createIdentifier('__source'),
            ts.createJsxExpression(undefined, ts.createObjectLiteral([fileNameAttr, lineNumberAttr]))
        )
        const jsxAttributes = ts.createJsxAttributes([
            ...node.attributes.properties,
            sourceJsxAttr
        ])

        if (ts.isJsxSelfClosingElement(node)) {
            return ts.createJsxSelfClosingElement(
                node.tagName,
                node.typeArguments,
                jsxAttributes
            )
        } else if (ts.isJsxOpeningElement(node)) {
            return ts.createJsxOpeningElement(
                node.tagName,
                node.typeArguments,
                jsxAttributes
            )
        }
    }
}
