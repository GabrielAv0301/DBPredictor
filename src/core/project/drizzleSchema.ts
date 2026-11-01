import * as ts from 'typescript';
import { getCallChain, propertyName, unwrap } from '../analysis/ast';

export interface DrizzleTable {
    /** Exported variable (`export const users = pgTable(…)`). */
    variable: string;
    /** Database table name. */
    name: string;
    schema?: string;
    /** Property → column name, when the column name is explicit. */
    columns: Record<string, string>;
}

/** Quick pre-filter to avoid parsing files that cannot contain table definitions. */
export function mayContainDrizzleTables(text: string): boolean {
    return /\bpgTable(?:Creator)?\s*\(|\bpgSchema\s*\(/.test(text);
}

interface Factories {
    /** identifier → name transform (`pgTableCreator((n) => \`app_${n}\`)`). */
    creators: Map<string, (name: string) => string>;
    /** identifier → schema name (`const auth = pgSchema('auth')`). */
    schemas: Map<string, string>;
}

function stringArg(node: ts.Expression | undefined): string | undefined {
    if (!node) return undefined;
    const e = unwrap(node);
    return ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) ? e.text : undefined;
}

/** Supports `(name) => \`prefix_${name}\`` and `(name) => 'p_' + name`. */
function creatorTransform(fn: ts.Expression | undefined): ((name: string) => string) | undefined {
    if (!fn) return undefined;
    const f = unwrap(fn);
    if (!ts.isArrowFunction(f) && !ts.isFunctionExpression(f)) return undefined;
    const param = f.parameters[0];
    if (!param || !ts.isIdentifier(param.name)) return undefined;
    const paramName = param.name.text;

    let body: ts.Expression | undefined;
    if (ts.isArrowFunction(f) && !ts.isBlock(f.body)) body = unwrap(f.body);
    else {
        const block = f.body as ts.Block;
        const ret = block.statements.find(ts.isReturnStatement);
        body = ret?.expression ? unwrap(ret.expression) : undefined;
    }
    if (!body) return undefined;

    if (ts.isTemplateExpression(body) && body.templateSpans.length === 1) {
        const span = body.templateSpans[0];
        if (ts.isIdentifier(span.expression) && span.expression.text === paramName) {
            const head = body.head.text;
            const tail = span.literal.text;
            return (name) => `${head}${name}${tail}`;
        }
    }
    if (ts.isBinaryExpression(body) && body.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const left = stringArg(body.left);
        const right = unwrap(body.right);
        if (left !== undefined && ts.isIdentifier(right) && right.text === paramName) {
            return (name) => `${left}${name}`;
        }
    }
    return undefined;
}

function columnsFrom(node: ts.Expression | undefined): Record<string, string> {
    const columns: Record<string, string> = {};
    if (!node) return columns;
    let obj = unwrap(node);
    // Drizzle v1 callback style: pgTable('t', (t) => ({ … }))
    if (ts.isArrowFunction(obj) && !ts.isBlock(obj.body)) obj = unwrap(obj.body);
    if (!ts.isObjectLiteralExpression(obj)) return columns;

    for (const prop of obj.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        const key = propertyName(prop.name);
        if (!key) continue;
        const init = unwrap(prop.initializer);
        if (!ts.isCallExpression(init)) continue;
        // integer('user_id').notNull().references(…) → first call carries the name.
        const { calls } = getCallChain(init);
        const explicit = stringArg(calls[0]?.args[0]);
        if (explicit !== undefined) columns[key] = explicit;
    }
    return columns;
}

/** Extracts Drizzle (PostgreSQL) table definitions from a source file. */
export function parseDrizzleTables(text: string, fileName = 'schema.ts'): DrizzleTable[] {
    if (!mayContainDrizzleTables(text)) return [];
    const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
    const factories: Factories = { creators: new Map(), schemas: new Map() };
    const tables: DrizzleTable[] = [];

    const visit = (node: ts.Node) => {
        if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.initializer &&
            ts.isCallExpression(unwrap(node.initializer))
        ) {
            const call = unwrap(node.initializer) as ts.CallExpression;
            const callee = unwrap(call.expression);
            const variable = node.name.text;

            if (ts.isIdentifier(callee)) {
                if (callee.text === 'pgSchema') {
                    const schema = stringArg(call.arguments[0]);
                    if (schema) factories.schemas.set(variable, schema);
                } else if (callee.text === 'pgTableCreator') {
                    const transform = creatorTransform(call.arguments[0]);
                    if (transform) factories.creators.set(variable, transform);
                } else if (callee.text === 'pgTable' || factories.creators.has(callee.text)) {
                    const raw = stringArg(call.arguments[0]);
                    if (raw !== undefined) {
                        const transform = factories.creators.get(callee.text);
                        tables.push({
                            variable,
                            name: transform ? transform(raw) : raw,
                            columns: columnsFrom(call.arguments[1]),
                        });
                    }
                }
            } else if (
                ts.isPropertyAccessExpression(callee) &&
                callee.name.text === 'table' &&
                ts.isIdentifier(unwrap(callee.expression))
            ) {
                const owner = (unwrap(callee.expression) as ts.Identifier).text;
                const schema = factories.schemas.get(owner);
                const raw = stringArg(call.arguments[0]);
                if (schema && raw !== undefined) {
                    tables.push({
                        variable,
                        name: raw,
                        schema,
                        columns: columnsFrom(call.arguments[1]),
                    });
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return tables;
}
