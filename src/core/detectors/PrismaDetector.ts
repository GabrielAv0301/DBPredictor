import * as ts from 'typescript';
import type { MutationOperation } from '../../shared/types';
import { propertyName, receiverName, templateText, toFilterValue, unwrap } from '../analysis/ast';
import { classifyRawSql } from '../sql/rawSql';
import type { DetectorOptions, FilterCondition, FilterOperator, FilterValue } from './types';
import type { PartialMutation } from './shared';

const MUTATION_METHODS = new Set<MutationOperation>([
    'delete',
    'update',
    'deleteMany',
    'updateMany',
]);
const RAW_METHODS = new Set(['$executeRaw', '$executeRawUnsafe', '$queryRaw', '$queryRawUnsafe']);

const SIMPLE_OPERATORS: Record<string, FilterOperator> = {
    equals: 'eq',
    not: 'neq',
    gt: 'gt',
    gte: 'gte',
    lt: 'lt',
    lte: 'lte',
    in: 'in',
};

interface WhereAnalysis {
    hasWhere: boolean;
    filters: FilterCondition[];
    complete: boolean;
}

function escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Detects Prisma Client mutations:
 *   prisma.user.deleteMany({ where: … }), tx.post.update(…), this.prisma.user.delete(…)
 *   prisma.$executeRaw`DELETE FROM …`
 */
export class PrismaDetector {
    private readonly clientNames: Set<string>;

    constructor(options: DetectorOptions) {
        this.clientNames = new Set(options.prismaClientNames);
    }

    public inspectCall(node: ts.CallExpression): PartialMutation | null {
        return this.inspectModelCall(node) ?? this.inspectRawCall(node);
    }

    public inspectTaggedTemplate(node: ts.TaggedTemplateExpression): PartialMutation | null {
        const tag = unwrap(node.tag);
        if (!ts.isPropertyAccessExpression(tag)) return null;
        if (!RAW_METHODS.has(tag.name.text)) return null;
        if (!this.isClient(tag.expression)) return null;
        return this.fromRawSql(templateText(node.template));
    }

    private isClient(expr: ts.Expression): boolean {
        const name = receiverName(expr);
        return name !== undefined && this.clientNames.has(name);
    }

    private inspectModelCall(node: ts.CallExpression): PartialMutation | null {
        const callee = unwrap(node.expression);
        if (!ts.isPropertyAccessExpression(callee)) return null;
        const method = callee.name.text as MutationOperation;
        if (!MUTATION_METHODS.has(method)) return null;

        const modelAccess = unwrap(callee.expression);
        if (!ts.isPropertyAccessExpression(modelAccess)) return null;
        const model = modelAccess.name.text;
        if (model.startsWith('$')) return null;
        if (!this.isClient(modelAccess.expression)) return null;

        const arg = node.arguments[0] ? unwrap(node.arguments[0]) : undefined;
        const argsObject = arg && ts.isObjectLiteralExpression(arg) ? arg : undefined;

        // `delete` / `update` are common method names (Map#delete…): Prisma requires
        // a `where` for them, so insist on seeing it to avoid false positives.
        const whereProp = argsObject?.properties.find(
            (p): p is ts.PropertyAssignment | ts.ShorthandPropertyAssignment =>
                (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
                propertyName(p.name) === 'where'
        );
        const isSingle = method === 'delete' || method === 'update';
        if (isSingle && !whereProp) return null;

        let where: WhereAnalysis;
        if (!arg) {
            where = { hasWhere: false, filters: [], complete: true };
        } else if (!argsObject) {
            // deleteMany(args) with a variable: we can't see the filter.
            where = { hasWhere: true, filters: [], complete: false };
        } else if (argsObject.properties.some((p) => ts.isSpreadAssignment(p))) {
            where = { hasWhere: true, filters: [], complete: false };
        } else if (!whereProp) {
            where = { hasWhere: false, filters: [], complete: true };
        } else if (ts.isShorthandPropertyAssignment(whereProp)) {
            where = { hasWhere: true, filters: [], complete: false };
        } else {
            where = this.analyzeWhere(whereProp.initializer);
        }

        return {
            orm: 'prisma',
            operation: method,
            table: { kind: 'prisma-model', name: model },
            hasWhere: where.hasWhere,
            filters: where.filters,
            filtersComplete: where.complete,
        };
    }

    private inspectRawCall(node: ts.CallExpression): PartialMutation | null {
        const callee = unwrap(node.expression);
        if (!ts.isPropertyAccessExpression(callee)) return null;
        if (!RAW_METHODS.has(callee.name.text)) return null;
        if (!this.isClient(callee.expression)) return null;
        const first = node.arguments[0];
        return first ? this.fromRawSql(templateText(first)) : null;
    }

    private fromRawSql(sql: string | undefined): PartialMutation | null {
        if (sql === undefined) return null;
        const raw = classifyRawSql(sql);
        if (!raw) return null;
        return {
            orm: 'raw-sql',
            operation: raw.operation,
            table: raw.table
                ? { kind: 'sql-name', name: raw.table, schema: raw.schema }
                : { kind: 'unknown', name: '(dynamic table)' },
            hasWhere: raw.hasWhere,
            filters: [],
            filtersComplete: !raw.hasWhere,
            truncateCascade: raw.truncateCascade,
        };
    }

    private analyzeWhere(initializer: ts.Expression): WhereAnalysis {
        const expr = unwrap(initializer);
        if (!ts.isObjectLiteralExpression(expr)) {
            // `where: someVariable` / `where: undefined`
            const value = toFilterValue(expr);
            if (value === undefined) return { hasWhere: false, filters: [], complete: true };
            return { hasWhere: true, filters: [], complete: false };
        }
        const result: WhereAnalysis = { hasWhere: false, filters: [], complete: true };
        this.collectConditions(expr, result);
        return result;
    }

    private collectConditions(obj: ts.ObjectLiteralExpression, out: WhereAnalysis): void {
        for (const prop of obj.properties) {
            if (ts.isShorthandPropertyAssignment(prop)) {
                // `{ id }` → id = <id>
                out.hasWhere = true;
                out.filters.push({
                    field: prop.name.text,
                    operator: 'eq',
                    value: { kind: 'expression', text: prop.name.text },
                });
                continue;
            }
            if (!ts.isPropertyAssignment(prop)) {
                // spread, methods, accessors
                out.hasWhere = true;
                out.complete = false;
                continue;
            }
            const key = propertyName(prop.name);
            if (key === undefined) {
                out.hasWhere = true;
                out.complete = false;
                continue;
            }
            const value = unwrap(prop.initializer);

            if (key === 'AND') {
                const items = ts.isArrayLiteralExpression(value) ? value.elements : [value];
                for (const item of items) {
                    const inner = unwrap(item);
                    if (ts.isObjectLiteralExpression(inner)) {
                        this.collectConditions(inner, out);
                    } else {
                        out.hasWhere = true;
                        out.complete = false;
                    }
                }
                continue;
            }
            if (key === 'OR' || key === 'NOT') {
                out.hasWhere = true;
                out.complete = false;
                continue;
            }

            if (ts.isObjectLiteralExpression(value)) {
                this.collectOperatorObject(key, value, out);
                continue;
            }

            const filterValue = toFilterValue(value);
            if (filterValue === undefined) continue; // Prisma ignores `field: undefined`
            out.hasWhere = true;
            out.filters.push(this.equality(key, filterValue));
        }
    }

    private equality(field: string, value: FilterValue): FilterCondition {
        if (value.kind === 'literal' && value.value === null) {
            return { field, operator: 'isNull' };
        }
        return { field, operator: 'eq', value };
    }

    /** `{ email: { contains: 'x', mode: 'insensitive' } }`, `{ id: { in: [1, 2] } }`… */
    private collectOperatorObject(
        field: string,
        obj: ts.ObjectLiteralExpression,
        out: WhereAnalysis
    ): void {
        const entries = new Map<string, ts.Expression>();
        for (const p of obj.properties) {
            const key = ts.isPropertyAssignment(p) ? propertyName(p.name) : undefined;
            if (!ts.isPropertyAssignment(p) || key === undefined) {
                out.hasWhere = true;
                out.complete = false;
                return;
            }
            entries.set(key, p.initializer);
        }
        const insensitive = (() => {
            const mode = entries.get('mode');
            if (!mode) return false;
            const v = toFilterValue(mode);
            return v?.kind === 'literal' && v.value === 'insensitive';
        })();
        entries.delete('mode');

        for (const [op, raw] of entries) {
            const value = toFilterValue(raw);
            if (value === undefined) continue; // `{ gt: undefined }` is ignored by Prisma
            out.hasWhere = true;

            if (op === 'equals' && insensitive) {
                if (value.kind === 'literal' && typeof value.value === 'string') {
                    out.filters.push({
                        field,
                        operator: 'ilike',
                        value: { kind: 'literal', value: escapeLike(value.value) },
                    });
                } else {
                    out.complete = false;
                }
                continue;
            }

            if (op === 'contains' || op === 'startsWith' || op === 'endsWith') {
                if (value.kind === 'literal' && typeof value.value === 'string') {
                    const escaped = escapeLike(value.value);
                    const pattern =
                        op === 'contains'
                            ? `%${escaped}%`
                            : op === 'startsWith'
                              ? `${escaped}%`
                              : `%${escaped}`;
                    out.filters.push({
                        field,
                        operator: insensitive ? 'ilike' : 'like',
                        value: { kind: 'literal', value: pattern },
                    });
                } else {
                    out.complete = false;
                }
                continue;
            }

            const operator = SIMPLE_OPERATORS[op];
            if (!operator) {
                // notIn, relation filters (some/every/is), json filters…
                out.complete = false;
                continue;
            }
            if (ts.isObjectLiteralExpression(unwrap(raw))) {
                // `not: { … }` nested filter
                out.complete = false;
                continue;
            }
            if (insensitive) {
                // Case-insensitive comparison operators are not translated.
                out.complete = false;
                continue;
            }
            if (value.kind === 'literal' && value.value === null) {
                if (operator === 'eq') out.filters.push({ field, operator: 'isNull' });
                else if (operator === 'neq') out.filters.push({ field, operator: 'isNotNull' });
                else out.complete = false;
                continue;
            }
            if (operator === 'in' && value.kind === 'literal' && !Array.isArray(value.value)) {
                out.complete = false;
                continue;
            }
            out.filters.push({ field, operator, value });
        }
    }
}
