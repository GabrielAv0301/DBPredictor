import * as ts from 'typescript';

/**
 * Extracts a sequence of chained method calls from an AST node.
 * Useful for analyzing fluent APIs like Supabase (.from().delete()) or Drizzle (db.delete().where()).
 * @param node The CallExpression node to analyze.
 * @returns An object containing the parsed chain and the root identifier of the chain.
 */
export function getCallChain(node: ts.CallExpression): {
    chain: { name: string; args: ts.NodeArray<ts.Expression> }[];
    root: ts.Node | null;
} {
    const chain: { name: string; args: ts.NodeArray<ts.Expression> }[] = [];
    let current: ts.Node = node;

    while (ts.isCallExpression(current)) {
        const expr = current.expression;
        if (ts.isPropertyAccessExpression(expr)) {
            chain.push({ name: expr.name.text, args: current.arguments });
            current = expr.expression;
        } else if (ts.isIdentifier(expr)) {
            // End of chain (e.g., db.delete)
            chain.push({ name: expr.text, args: current.arguments });
            current = expr; // This is the root identifier if it was just db.delete()
            break;
        } else {
            break;
        }
    }

    return { chain, root: current };
}
