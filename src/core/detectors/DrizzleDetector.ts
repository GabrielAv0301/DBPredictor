import * as ts from 'typescript';
import {
    getCallChain,
    receiverName,
    templateText,
    toFilterValue,
    unwrap,
    type ChainCall,
} from '../analysis/ast';
import { classifyRawSql } from '../sql/rawSql';
import type { DetectorOptions, FilterCondition, FilterOperator } from './types';
import type { PartialMutation } from './shared';

const BINARY_OPERATORS: Record<string, FilterOperator> = {
    eq: 'eq',
    ne: 'neq',
    gt: 'gt',
    gte: 'gte',
    lt: 'lt',
    lte: 'lte',
    like: 'like',
    ilike: 'ilike',
    inArray: 'in',
};

/** Calls that run or wrap the query without changing it. */
const TERMINAL_METHODS = new Set([
    'execute',
    'then',
    'catch',
    'finally',
    'prepare',
    '$dynamic',
    'toSQL',
    'run',
    'all',
]);

interface WhereState {
    complete: boolean;
    filters: FilterCondition[];
}

export interface DrizzleFileContext {
    /** The file imports something from `drizzle-orm`. */
    importsDrizzle: boolean;
}

/**
 * Detects Drizzle ORM mutations:
 *   db.delete(users).where(eq(users.id, id))
 *   tx.update(schema.posts).set({ … })
 *   db.execute(sql`DELETE FROM …`)
 */
export class DrizzleDetector {
    private readonly clientNames: Set<string>;

    constructor(private readonly options: DetectorOptions) {
        this.clientNames = new Set(options.drizzleClientNames);
    }

    public inspectCall(node: ts.CallExpression, file: DrizzleFileContext): PartialMutation | null {
        const { calls, receiver } = getCallChain(node);
        const name = receiverName(receiver);
        if (!name || !this.clientNames.has(name) || calls.length === 0) return null;

        const first = calls[0];
        if (first.name === 'execute') return this.inspectRaw(first);
        if (first.name !== 'delete' && first.name !== 'update') return null;

        const tableArg = first.args[0] ? unwrap(first.args[0]) : undefined;
        if (!tableArg) return null;
        let tableVar: string;
        if (ts.isIdentifier(tableArg)) tableVar = tableArg.text;
        else if (ts.isPropertyAccessExpression(tableArg)) tableVar = tableArg.name.text;
        else return null;

        // Terminal calls (`.execute()`, `.then()`, `.prepare()`…) don't change which rows are hit.
        const rest = calls.slice(1).filter((c) => !TERMINAL_METHODS.has(c.name));
        const isDrizzleShaped =
            first.name === 'update'
                ? rest.some((c) => c.name === 'set')
                : rest.length === 0 || rest.every((c) => ['where', 'returning'].includes(c.name));
        if (!isDrizzleShaped) return null;

        // `db.delete(key)` is also the shape of Map / KV stores: require evidence of Drizzle.
        const knownTable = this.options.isKnownDrizzleTable?.(tableVar) ?? false;
        const hasDrizzleMethods = rest.some((c) => ['where', 'set', 'returning'].includes(c.name));
        if (!knownTable && !file.importsDrizzle && !hasDrizzleMethods) return null;

        const whereCall = rest.find((c) => c.name === 'where');
        let hasWhere = false;
        const state: WhereState = { complete: true, filters: [] };
        if (whereCall) {
            const arg = whereCall.args[0];
            if (arg && toFilterValue(arg) !== undefined) {
                // `.where(undefined)` / `.where(and(undefined))` are no-ops in Drizzle:
                // only count it as filtered when a condition was actually found.
                this.collect(arg, tableVar, state);
                hasWhere = state.filters.length > 0 || !state.complete;
            }
        }

        return {
            orm: 'drizzle',
            operation: first.name === 'delete' ? 'deleteMany' : 'updateMany',
            table: { kind: 'drizzle-variable', name: tableVar },
            hasWhere,
            filters: state.filters,
            filtersComplete: hasWhere ? state.complete : true,
        };
    }

    private inspectRaw(call: ChainCall): PartialMutation | null {
        const arg = call.args[0];
        if (!arg) return null;
        const raw = classifyRawSql(templateText(arg) ?? '');
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

    /** Column referenced as `users.id` (or `schema.users.id`) for the target table. */
    private columnOf(node: ts.Expression | undefined, tableVar: string): string | undefined {
        if (!node) return undefined;
        const e = unwrap(node);
        if (!ts.isPropertyAccessExpression(e)) return undefined;
        const owner = unwrap(e.expression);
        const ownerName = ts.isIdentifier(owner)
            ? owner.text
            : ts.isPropertyAccessExpression(owner)
              ? owner.name.text
              : undefined;
        return ownerName === tableVar ? e.name.text : undefined;
    }

    private collect(node: ts.Expression, tableVar: string, state: WhereState): void {
        const e = unwrap(node);
        if (!ts.isCallExpression(e) || !ts.isIdentifier(unwrap(e.expression))) {
            state.complete = false;
            return;
        }
        const fn = (unwrap(e.expression) as ts.Identifier).text;
        const args = e.arguments;

        if (fn === 'and') {
            for (const arg of args) {
                if (toFilterValue(arg) === undefined) continue; // and(cond, undefined)
                this.collect(arg, tableVar, state);
            }
            return;
        }

        if (fn === 'isNull' || fn === 'isNotNull') {
            const field = this.columnOf(args[0], tableVar);
            if (field) state.filters.push({ field, operator: fn });
            else state.complete = false;
            return;
        }

        const operator = BINARY_OPERATORS[fn];
        if (!operator) {
            state.complete = false; // or(), not(), sql``, exists()…
            return;
        }
        const field = this.columnOf(args[0], tableVar);
        const valueNode = args[1];
        if (!field || !valueNode) {
            state.complete = false;
            return;
        }
        // Column-to-column comparisons (`eq(t.a, t.b)`) are not values.
        if (this.columnOf(valueNode, tableVar)) {
            state.complete = false;
            return;
        }
        const value = toFilterValue(valueNode);
        if (!value || (value.kind === 'literal' && value.value === null)) {
            state.complete = false;
            return;
        }
        if (operator === 'in' && value.kind === 'literal' && !Array.isArray(value.value)) {
            state.complete = false;
            return;
        }
        state.filters.push({ field, operator, value });
    }
}
