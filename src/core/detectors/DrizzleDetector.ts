import * as ts from 'typescript';
import { MutationInfo, MutationDetector, MutationOperation, DocumentLike } from './DetectorInterface';

export class DrizzleDetector implements MutationDetector {
    private readonly TARGET_METHODS = ['delete', 'update'];
    private readonly TARGET_ALIASES = ['db', 'database', 'orm', 'client'];

    public detect(document: DocumentLike): MutationInfo[] {
        const sourceCode = document.getText();
        const sourceFile = ts.createSourceFile(
            document.fileName,
            sourceCode,
            ts.ScriptTarget.Latest,
            true
        );

        const mutations: MutationInfo[] = [];

        const visit = (node: ts.Node) => {
            if (ts.isCallExpression(node)) {
                // Evitamos doble conteo en cadenas db.delete().where()
                const isPartOfChain = ts.isPropertyAccessExpression(node.parent) && ts.isCallExpression(node.parent?.parent);

                if (!isPartOfChain) {
                    const mutation = this.extractDrizzleMutation(node, document);
                    if (mutation) {
                        mutations.push(mutation);
                    }
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
        return mutations;
    }

    // Extraer mutaciones de Drizzle ORM (db.delete(table)...)
    private extractDrizzleMutation(node: ts.CallExpression, document: DocumentLike): MutationInfo | null {
        const { chain, root } = this.getCallChain(node);

        // Soporte para múltiples alias de cliente (db, orm, etc)
        if (!root || !ts.isIdentifier(root) || !this.TARGET_ALIASES.includes(root.text)) return null;

        // La llamada raíz debe ser delete() o update()
        const rootCall = chain?.[chain.length - 1];
        if (!rootCall || !this.TARGET_METHODS.includes(rootCall.name)) return null;

        // Nombre de la tabla desde el primer argumento: delete(table)
        if (rootCall.args?.length === 0) return null;
        const tableArg = rootCall.args[0];

        let tableName: string;
        if (ts.isIdentifier(tableArg)) {
            tableName = tableArg.text;
        } else if (ts.isPropertyAccessExpression(tableArg)) {
            tableName = tableArg.name.text;
        } else {
            return null;
        }

        // Detectar si hay cláusula .where() en la cadena
        const hasWhere = chain?.some(c => c.name === 'where');

        const start = document.positionAt(node.getStart());
        const end = document.positionAt(node.getEnd());

        let operation: MutationOperation = 'updateMany';
        if (rootCall.name === 'delete') operation = 'deleteMany';

        return {
            table: tableName,
            operation,
            hasWhere,
            queryParams: [],
            range: { start, end },
            sourceText: node.getText()
        };
    }

    private getCallChain(node: ts.CallExpression): { chain: { name: string, args: ts.NodeArray<ts.Expression> }[], root: ts.Node | null } {
        const chain: { name: string, args: ts.NodeArray<ts.Expression> }[] = [];
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
}
