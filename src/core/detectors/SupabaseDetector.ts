import * as ts from 'typescript';
import { MutationInfo, MutationDetector, MutationOperation, DocumentLike } from './DetectorInterface';

export class SupabaseDetector implements MutationDetector {
    private readonly TARGET_METHODS = ['delete', 'update'];

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
                // Evitamos doble conteo en cadenas como .from().delete().eq()
                const isPartOfChain = ts.isPropertyAccessExpression(node.parent) && ts.isCallExpression(node.parent?.parent);

                if (!isPartOfChain) {
                    const mutation = this.extractSupabaseMutation(node, document);
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

    // Extraer mutaciones de cadenas de Supabase (.from().delete()...)
    private extractSupabaseMutation(node: ts.CallExpression, document: DocumentLike): MutationInfo | null {
        const chain = this.getCallChain(node);

        // Buscamos una cadena que tenga .from('tabla') y .delete() o .update()
        const fromCall = chain?.find(c => c.name === 'from');
        const opCall = chain?.find(c => this.TARGET_METHODS.includes(c.name));

        if (!fromCall || !opCall) return null;

        // Nombre de tabla desde from('nombre_tabla')
        if (fromCall.args?.length === 0 || !ts.isStringLiteral(fromCall.args?.[0])) return null;
        const tableName = fromCall.args[0].text;

        // Filtros (cláusula where parametrizada)
        const filterCalls = chain?.filter(c => 
            ['eq', 'match'].includes(c.name) // v1.1 soporta eq y match para simulación segura
        );

        let queryParams: { column: string, value: unknown }[] = [];
        if (filterCalls && filterCalls.length > 0) {
            queryParams = this.buildParams(filterCalls);
        }

        const start = document.positionAt(node.getStart());
        const end = document.positionAt(node.getEnd());

        return {
            table: tableName,
            operation: (opCall.name === 'delete' ? 'deleteMany' : 'updateMany') as MutationOperation,
            hasWhere: queryParams.length > 0,
            queryParams,
            range: { start, end },
            sourceText: node.getText()
        };
    }

    // Construir parámetros a partir de los filtros (.eq, .match...)
    private buildParams(filters: { name: string, args: ts.NodeArray<ts.Expression> }[]): { column: string, value: unknown }[] {
        const params: { column: string, value: unknown }[] = [];
        filters.forEach(f => {
            if (f.name === 'eq' && f.args?.length >= 2) {
                const col = ts.isStringLiteral(f.args[0]) ? f.args[0].text : f.args[0].getText();
                const valNode = f.args[1];
                params.push({ column: col, value: this.parseValue(valNode) });
            }
            if (f.name === 'match' && f.args?.length >= 1 && ts.isObjectLiteralExpression(f.args[0])) {
                f.args[0].properties.forEach(p => {
                    if (ts.isPropertyAssignment(p)) {
                        const name = ts.isStringLiteral(p.name) ? p.name.text : p.name.getText();
                        params.push({ column: name, value: this.parseValue(p.initializer) });
                    }
                });
            }
        });
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
    private getCallChain(node: ts.CallExpression): { name: string, args: ts.NodeArray<ts.Expression> }[] {
        const chain: { name: string, args: ts.NodeArray<ts.Expression> }[] = [];
        let current: ts.Node = node;

        while (ts.isCallExpression(current)) {
            const expr = current.expression;
            if (ts.isPropertyAccessExpression(expr)) {
                chain.push({ name: expr.name.text, args: current.arguments });
                current = expr.expression;
            } else {
                break;
            }
        }

        return chain;
    }
}
