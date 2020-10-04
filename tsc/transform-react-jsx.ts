import ts from 'https://esm.sh/typescript'

export default function transformReactJsx(sf: ts.SourceFile, node: ts.Node, options: { mode: 'development' | 'production', rewriteImportPath: (importPath: string, async: boolean) => string }): ts.VisitResult<ts.Node> {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        let props = Array.from(node.attributes.properties)

        if (node.tagName.getText() === 'Import') {
            for (let i = 0; i < node.attributes.properties.length; i++) {
                const prop = node.attributes.properties[i]
                if (ts.isJsxAttribute(prop) && prop.name.text === 'from' && prop.initializer && ts.isStringLiteral(prop.initializer)) {
                    options.rewriteImportPath(prop.initializer.text, true)
                }
            }
        }

        if (options.mode === 'development') {
            const fileNameAttr = ts.createPropertyAssignment(
                'fileName',
                ts.createStringLiteral(sf.fileName)
            )
            const lineNumberAttr = ts.createPropertyAssignment(
                'lineNumber',
                ts.createNumericLiteral((sf.getLineAndCharacterOfPosition(node.pos).line + 1).toString())
            )
            const prop = ts.createJsxAttribute(
                ts.createIdentifier('__source'),
                ts.createJsxExpression(undefined, ts.createObjectLiteral([fileNameAttr, lineNumberAttr]))
            )
            props.push(prop)
        }

        if (ts.isJsxSelfClosingElement(node)) {
            return ts.createJsxSelfClosingElement(
                node.tagName,
                node.typeArguments,
                ts.createJsxAttributes(props)
            )
        } else if (ts.isJsxOpeningElement(node)) {
            return ts.createJsxOpeningElement(
                node.tagName,
                node.typeArguments,
                ts.createJsxAttributes(props)
            )
        }
    }
}
