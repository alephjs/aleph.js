import ts from 'https://esm.sh/typescript'
import { path } from '../std.ts'

export default function transformReactJsx(sf: ts.SourceFile, node: ts.Node, options: { mode: 'development' | 'production', rewriteImportPath: (importPath: string) => string }): ts.VisitResult<ts.Node> {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        let props = Array.from(node.attributes.properties)

        if (node.tagName.getText() === 'Import') {
            let rawPath = ''
            for (let i = 0; i < props.length; i++) {
                const prop = props[i]
                if (ts.isJsxAttribute(prop) && prop.name.text === 'from' && prop.initializer && ts.isStringLiteral(prop.initializer)) {
                    rawPath = prop.initializer.text
                    props[i] = ts.createJsxAttribute(
                        ts.createIdentifier('from'),
                        ts.createJsxExpression(undefined, ts.createStringLiteral(options.rewriteImportPath(rawPath)))
                    )
                    break
                }
            }
            if (rawPath) {
                props.push(
                    ts.createJsxAttribute(
                        ts.createIdentifier('rawPath'),
                        ts.createJsxExpression(undefined, ts.createStringLiteral(rawPath))
                    ),
                    ts.createJsxAttribute(
                        ts.createIdentifier('resolveDir'),
                        ts.createJsxExpression(undefined, ts.createStringLiteral(path.dirname(sf.fileName)))
                    )
                )
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
