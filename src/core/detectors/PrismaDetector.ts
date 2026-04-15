import * as vscode from 'vscode';
import * as ts from 'typescript';
import { MutationInfo, MutationDetector, MutationOperation } from './DetectorInterface';
import { Logger } from '../../utils/logger';

export class PrismaDetector implements MutationDetector {
    private readonly MUTATION_METHODS: MutationOperation[] = ['deleteMany', 'updateMany', 'delete', 'update'];

    public detect(document: vscode.TextDocument): MutationInfo[] {
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
                const mutation = this.extractMutation(node, document);
                if (mutation) {
                    mutations.push(mutation);
                }
            }
            ts.forEachChild(node, visit);
        };

        visit(sourceFile);
        return mutations;
    }

    // Extraer mutaciones de Prisma (prisma.user.deleteMany...)
    private extractMutation(node: ts.CallExpression, document: vscode.TextDocument): MutationInfo | null {
        const expression = node.expression;
        if (!ts.isPropertyAccessExpression(expression)) return null;

        const methodName = expression.name.text;
        if (!this.MUTATION_METHODS.includes(methodName as MutationOperation)) return null;

        // Validar acceso a tabla (prisma.user)
        const tableAccess = expression.expression;
        if (!ts.isPropertyAccessExpression(tableAccess)) return null;
        if (!ts.isIdentifier(tableAccess.expression) || tableAccess.expression.text !== 'prisma') {
            return null;
        }

        const tableName = tableAccess.name.text;
        
        // Extraer filtros 'where' de los argumentos
        let hasWhere = false;
        let queryParams: { column: string, value: unknown }[] = [];

        if (node.arguments.length > 0) {
            const firstArg = node.arguments[0];
            if (ts.isObjectLiteralExpression(firstArg)) {
                const whereProp = firstArg.properties.find(prop => 
                    ts.isPropertyAssignment(prop) && 
                    ts.isIdentifier(prop.name) && 
                    prop.name.text === 'where'
                ) as ts.PropertyAssignment | undefined;

                if (whereProp && ts.isObjectLiteralExpression(whereProp.initializer)) {
                    hasWhere = true;
                    queryParams = this.extractParams(whereProp.initializer);
                }
            }
        }

        const start = document.positionAt(node.getStart());
        const end = document.positionAt(node.getEnd());

        return {
            table: tableName,
            operation: methodName as MutationOperation,
            hasWhere,
            queryParams,
            range: new vscode.Range(start, end),
            sourceText: node.getText()
        };
    }

    // Extraer literales del objeto 'where' como parámetros seguros
    private extractParams(node: ts.ObjectLiteralExpression): { column: string, value: unknown }[] {
        const params: { column: string, value: unknown }[] = [];
        for (const prop of node.properties) {
            if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
            
            const field = prop.name.text;
            const value = prop.initializer;

            if (ts.isStringLiteral(value)) {
                params.push({ column: field, value: value.text });
            } else if (ts.isNumericLiteral(value)) {
                params.push({ column: field, value: Number(value.text) });
            } else if (value.kind === ts.SyntaxKind.TrueKeyword) {
                params.push({ column: field, value: true });
            } else if (value.kind === ts.SyntaxKind.FalseKeyword) {
                params.push({ column: field, value: false });
            } else if (value.kind === ts.SyntaxKind.NullKeyword) {
                params.push({ column: field, value: null });
            }
        }
        return params;
    }
}
