import ts from 'https://esm.sh/typescript@4.0.5'
import { path } from '../deps.ts'

export default function transformReactJsx(sf: ts.SourceFile, node: ts.Node, options: { mode: 'development' | 'production', rewriteImportPath: (importPath: string) => string }): ts.VisitResult<ts.Node> {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        let props = Array.from(node.attributes.properties)

        if (node.tagName.getText() === 'Import') {
            for (let i = 0; i < props.length; i++) {
                const prop = props[i]
                if (ts.isJsxAttribute(prop) && prop.name.text === 'from' && prop.initializer && ts.isStringLiteral(prop.initializer)) {
                    const url = options.rewriteImportPath(prop.initializer.text)
                    props.splice(i, 1)
                    props.unshift(
                        ts.createJsxAttribute(
                            ts.createIdentifier('from'),
                            ts.createJsxExpression(undefined, ts.factory.createStringLiteral(url))
                        ),
                        ts.createJsxAttribute(
                            ts.createIdentifier('__sourceFile'),
                            ts.createJsxExpression(undefined, ts.factory.createStringLiteral(path.join(path.dirname(sf.fileName), prop.initializer.text)))
                        ),
                        ts.createJsxAttribute(
                            ts.createIdentifier('__importer'),
                            ts.createJsxExpression(undefined, ts.factory.createStringLiteral(sf.fileName))
                        )
                    )
                    break
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
