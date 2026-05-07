import * as ts from 'typescript';
import {
    MutationInfo,
    MutationDetector,
    MutationOperation,
    DocumentLike,
} from './DetectorInterface';
import { getCallChain } from '../../utils/ast';

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
                const isPartOfChain =
                    ts.isPropertyAccessExpression(node.parent) &&
                    ts.isCallExpression(node.parent?.parent);

                if (!isPartOfChain) {
                    const mutation = this.extractDrizzleMutation(node, document);
                    if (mutation) {
                        mutations.push(mutation);
                    }
                    const raw = this.extractRawMutation(node, document);
                    if (raw) {
                        mutations.push(raw);
                    }
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
        return mutations;
    }

    // Extraer mutaciones de Drizzle Raw (db.execute(sql))
    private extractRawMutation(
        node: ts.CallExpression,
        document: DocumentLike
    ): MutationInfo | null {
        const { chain, root } = getCallChain(node);
        if (!root || !ts.isIdentifier(root) || !this.TARGET_ALIASES.includes(root.text))
            return null;

        const call = chain?.[0];
        if (!call || call.name !== 'execute' || call.args.length === 0) return null;

        const sqlText = call.args[0].getText();
        let tableName = 'RAW_QUERY';
        const tableMatch = sqlText.match(/(?:FROM|UPDATE|INTO)\s+["']?([a-zA-Z0-9_.]+)/i);
        if (tableMatch) {
            tableName = tableMatch[1];
        }

        const start = document.positionAt(node.getStart());
        const end = document.positionAt(node.getEnd());

        return {
            table: tableName,
            operation: 'updateMany',
            hasWhere: false,
            queryParams: [],
            range: { start, end },
            sourceText: node.getText(),
        };
    }

    // Extraer mutaciones de Drizzle ORM (db.delete(table)...)
    private extractDrizzleMutation(
        node: ts.CallExpression,
        document: DocumentLike
    ): MutationInfo | null {
        const { chain, root } = getCallChain(node);

        // Soporte para múltiples alias de cliente (db, orm, etc)
        if (!root || !ts.isIdentifier(root) || !this.TARGET_ALIASES.includes(root.text))
            return null;

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
        const whereCall = chain?.find((c) => c.name === 'where');
        let queryParams: { column: string; value: unknown }[] = [];

        if (whereCall && whereCall.args.length > 0) {
            queryParams = this.extractWhereParams(whereCall.args[0]);
        }

        const start = document.positionAt(node.getStart());
        const end = document.positionAt(node.getEnd());

        let operation: MutationOperation = 'updateMany';
        if (rootCall.name === 'delete') operation = 'deleteMany';

        return {
            table: tableName,
            operation,
            hasWhere: queryParams.length > 0,
            queryParams,
            range: { start, end },
            sourceText: node.getText(),
        };
    }

    private extractWhereParams(node: ts.Node): { column: string; value: unknown }[] {
        const params: { column: string; value: unknown }[] = [];

        // Drizzle suele usar eq(table.column, value)
        if (ts.isCallExpression(node)) {
            const expr = node.expression;
            if (ts.isIdentifier(expr) && expr.text === 'eq' && node.arguments.length >= 2) {
                const colArg = node.arguments[0];
                const valArg = node.arguments[1];

                const columnName = ts.isPropertyAccessExpression(colArg)
                    ? colArg.name.text
                    : colArg.getText();

                params.push({ column: columnName, value: this.parseValue(valArg) });
            }
        }

        return params;
    }

    private parseValue(node: ts.Node): unknown {
        if (ts.isStringLiteral(node)) return node.text;
        if (ts.isNumericLiteral(node)) return Number(node.text);
        if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
        if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
        if (node.kind === ts.SyntaxKind.NullKeyword) return null;
        return node.getText();
    }
}
