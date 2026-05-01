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
                const isPartOfChain =
                    ts.isPropertyAccessExpression(node.parent) &&
                    ts.isCallExpression(node.parent?.parent);

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

    private extractDrizzleMutation(
        node: ts.CallExpression,
        document: DocumentLike
    ): MutationInfo | null {
        const { chain, root } = getCallChain(node);

        if (!root || !ts.isIdentifier(root) || !this.TARGET_ALIASES.includes(root.text)) {
            return null;
        }

        const rootCall = chain?.[chain.length - 1];
        if (!rootCall || !this.TARGET_METHODS.includes(rootCall.name)) return null;

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

        const hasWhere = chain?.some((c) => c.name === 'where');
        const queryParams = this.extractWhereParams(chain);

        const start = document.positionAt(node.getStart());
        const end = document.positionAt(node.getEnd());

        let operation: MutationOperation = 'updateMany';
        if (rootCall.name === 'delete') operation = 'deleteMany';

        return {
            table: tableName,
            operation,
            hasWhere,
            queryParams,
            range: { start, end },
            sourceText: node.getText(),
        };
    }

    private extractWhereParams(
        chain: { name: string; args: ts.NodeArray<ts.Expression> }[] | undefined
    ): { column: string; value: unknown }[] {
        const params: { column: string; value: unknown }[] = [];
        const whereCall = chain?.find((c) => c.name === 'where');
        if (!whereCall || !whereCall.args?.[0]) return params;

        const whereArg = whereCall.args[0];

        // Handle: eq(table.column, value)  — most common
        if (ts.isCallExpression(whereArg)) {
            const extracted = this.parseEqCall(whereArg);
            if (extracted) params.push(extracted);
        }

        // Handle: and(eq(...), eq(...))
        if (
            ts.isCallExpression(whereArg) &&
            whereArg.expression &&
            ts.isIdentifier(whereArg.expression) &&
            whereArg.expression.text === 'and'
        ) {
            for (const arg of whereArg.arguments) {
                if (ts.isCallExpression(arg)) {
                    const extracted = this.parseEqCall(arg);
                    if (extracted) params.push(extracted);
                }
            }
        }

        return params;
    }

    private parseEqCall(node: ts.CallExpression): { column: string; value: unknown } | null {
        const expr = node.expression;
        if (!ts.isIdentifier(expr) || expr.text !== 'eq') return null;
        if (node.arguments.length < 2) return null;

        const colArg = node.arguments[0];
        const valArg = node.arguments[1];

        let column: string;
        if (ts.isPropertyAccessExpression(colArg)) {
            column = colArg.name.text;
        } else if (ts.isIdentifier(colArg)) {
            column = colArg.text;
        } else {
            return null;
        }

        return { column, value: this.parseValue(valArg) };
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
