import * as ts from 'typescript';
import { getCallChain, propertyName, toFilterValue, unwrap, type ChainCall } from '../analysis/ast';
import type { FilterCondition, FilterOperator } from './types';
import type { PartialMutation } from './shared';

const OPERATION_METHODS = new Set(['delete', 'update']);

const BINARY_FILTERS: Record<string, FilterOperator> = {
    eq: 'eq',
    neq: 'neq',
    gt: 'gt',
    gte: 'gte',
    lt: 'lt',
    lte: 'lte',
    like: 'like',
    ilike: 'ilike',
    in: 'in',
};

/** Modifiers that don't change which rows are affected. */
const NEUTRAL_METHODS = new Set([
    'select',
    'single',
    'maybeSingle',
    'order',
    'limit',
    'returns',
    'overrideTypes',
    'throwOnError',
    'abortSignal',
    'csv',
    'geojson',
    'explain',
    'setHeader',
    'then',
    'catch',
    'finally',
]);

interface FilterState {
    hasWhere: boolean;
    complete: boolean;
    filters: FilterCondition[];
}

/** Plain column name; JSON paths (`data->a`) and casts are not translated. */
function columnName(node: ts.Expression | undefined): string | undefined {
    if (!node) return undefined;
    const value = toFilterValue(node);
    if (value?.kind !== 'literal' || typeof value.value !== 'string') return undefined;
    return /^[\w$]+$/.test(value.value) ? value.value : undefined;
}

/**
 * Detects supabase-js mutations:
 *   supabase.from('users').delete().eq('id', 1)
 *   supabase.schema('billing').from('invoices').update({...}).lt('due', date)
 */
export class SupabaseDetector {
    public inspectCall(node: ts.CallExpression): PartialMutation | null {
        const { calls } = getCallChain(node);
        const fromIndex = calls.findIndex((c) => c.name === 'from');
        if (fromIndex < 0) return null;
        const opCall = calls[fromIndex + 1];
        // The operation must come right after `.from()` in supabase-js.
        if (!opCall || !OPERATION_METHODS.has(opCall.name)) return null;

        const table = columnName(calls[fromIndex].args[0]);
        if (!table) return null;

        const schemaCall = calls.slice(0, fromIndex).find((c) => c.name === 'schema');
        const schema = schemaCall ? columnName(schemaCall.args[0]) : undefined;

        const state: FilterState = { hasWhere: false, complete: true, filters: [] };
        for (const call of calls.slice(fromIndex + 2)) {
            this.applyFilter(call, state);
        }

        return {
            orm: 'supabase',
            operation: opCall.name === 'delete' ? 'deleteMany' : 'updateMany',
            table: { kind: 'sql-name', name: table, schema },
            hasWhere: state.hasWhere,
            filters: state.filters,
            filtersComplete: state.complete,
        };
    }

    private applyFilter(call: ChainCall, state: FilterState): void {
        const { name, args } = call;
        if (NEUTRAL_METHODS.has(name)) return;

        const binary = BINARY_FILTERS[name];
        if (binary) {
            state.hasWhere = true;
            const field = columnName(args[0]);
            const value = args[1] ? toFilterValue(args[1]) : undefined;
            if (!field || !value) {
                state.complete = false;
                return;
            }
            if (value.kind === 'literal' && value.value === null) {
                // PostgREST `eq.null` compares with = NULL, which matches nothing.
                state.complete = false;
                return;
            }
            if (binary === 'in' && value.kind === 'literal' && !Array.isArray(value.value)) {
                state.complete = false;
                return;
            }
            state.filters.push({ field, operator: binary, value });
            return;
        }

        if (name === 'is') {
            state.hasWhere = true;
            const field = columnName(args[0]);
            const value = args[1] ? toFilterValue(args[1]) : undefined;
            if (field && value?.kind === 'literal' && value.value === null) {
                state.filters.push({ field, operator: 'isNull' });
            } else if (field && value?.kind === 'literal' && typeof value.value === 'boolean') {
                state.filters.push({ field, operator: 'eq', value });
            } else {
                state.complete = false;
            }
            return;
        }

        if (name === 'match') {
            const arg = args[0] ? unwrap(args[0]) : undefined;
            if (!arg || !ts.isObjectLiteralExpression(arg)) {
                state.hasWhere = true;
                state.complete = false;
                return;
            }
            // `.match({})` adds no condition at all.
            if (arg.properties.length > 0) state.hasWhere = true;
            for (const p of arg.properties) {
                const key = ts.isPropertyAssignment(p) ? propertyName(p.name) : undefined;
                const value = ts.isPropertyAssignment(p) ? toFilterValue(p.initializer) : undefined;
                if (!key || !value || (value.kind === 'literal' && value.value === null)) {
                    state.complete = false;
                    continue;
                }
                state.filters.push({ field: key, operator: 'eq', value });
            }
            return;
        }

        if (name === 'not') {
            state.hasWhere = true;
            const field = columnName(args[0]);
            const op = args[1] ? toFilterValue(args[1]) : undefined;
            const value = args[2] ? toFilterValue(args[2]) : undefined;
            if (
                field &&
                op?.kind === 'literal' &&
                op.value === 'is' &&
                value?.kind === 'literal' &&
                value.value === null
            ) {
                state.filters.push({ field, operator: 'isNotNull' });
            } else {
                state.complete = false;
            }
            return;
        }

        // Every other PostgrestFilterBuilder method (or, filter, contains, textSearch…)
        // restricts rows but is not translated to SQL.
        state.hasWhere = true;
        state.complete = false;
    }
}
