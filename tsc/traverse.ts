// @deno-types="../vendor/typescript/lib/typescript.d.ts"
import ts from '../vendor/typescript/lib/typescript.js'

export function traverse(sf: ts.SourceFile, callback: (node: ts.Node) => void) {
    traverseNode(sf)

    function traverseNode(node: ts.Node) {
        callback(node)
        ts.forEachChild(node, traverseNode)
    }
}
