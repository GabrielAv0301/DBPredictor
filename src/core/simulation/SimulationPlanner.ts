import type { FkRule } from '../../shared/types';
import type { FilterCondition, LiteralValue, MutationInfo } from '../detectors/types';
import { isDelete } from '../impact/ImpactEngine';
import type { ProjectModel } from '../project/ProjectModel';
import { resolveColumn } from '../schema/resolver';
import { tableId, type SchemaIndex, type TableInfo } from '../schema/types';
import { quoteIdent, quoteTable } from '../sql/identifiers';

export type SqlParam = string | number | boolean | null | (string | number | boolean | null)[];

export const MAX_SIMULATION_DEPTH = 6;
export const MAX_SIMULATION_QUERIES = 60;

export interface PlannedQuery {
    sql: string;
    table: string;
    rule: FkRule | 'BASE';
    depth: number;
}

export interface SimulationPlan {
    queries: PlannedQuery[];
    /** Shared by every query: nested sub-queries reuse the same placeholders. */
    params: SqlParam[];
    exact: boolean;
    /** Cascade totals are approximate (self references, depth limit, overlapping paths). */
    cascadeApproximate: boolean;
    warnings: string[];
}

/** Values supplied by the user for filters whose value is a runtime expression, by filter index. */
export type SuppliedValues = ReadonlyMap<number, LiteralValue | LiteralValue[]>;

const COMPARISON: Record<string, string> = {
    eq: '=',
    neq: '<>',
    gt: '>',
    gte: '>=',
    lt: '<',
    lte: '<=',
    like: 'LIKE',
    ilike: 'ILIKE',
};

/**
 * Builds read-only COUNT queries that measure exactly what a mutation would
 * touch: the rows matched by its filter and, for deletes, every row reached
 * through foreign keys (CASCADE / SET NULL / RESTRICT).
 *
 * Identifiers come from the database catalog (never from user code) and are
 * always quoted; every value is a bind parameter.
 */
export function planSimulation(
    mutation: MutationInfo,
    table: TableInfo,
    index: SchemaIndex,
    project: ProjectModel,
    supplied: SuppliedValues = new Map()
): SimulationPlan {
    const params: SqlParam[] = [];
    const warnings: string[] = [];
    const conditions: string[] = [];
    let exact = mutation.filtersComplete;
    let cascadeApproximate = false;

    if (mutation.orm === 'raw-sql' && mutation.hasWhere) {
        exact = false;
        warnings.push('Raw SQL filters are not translated: the count covers the whole table.');
    }

    mutation.filters.forEach((filter: FilterCondition, i) => {
        const column = resolveColumn(filter.field, table, mutation.table, project);
        if (!column) {
            exact = false;
            warnings.push(
                `Ignored filter on "${filter.field}": no such column in ${tableId(table)}.`
            );
            return;
        }
        const col = quoteIdent(column);

        if (filter.operator === 'isNull' || filter.operator === 'isNotNull') {
            conditions.push(`${col} IS ${filter.operator === 'isNull' ? '' : 'NOT '}NULL`);
            return;
        }

        let value: LiteralValue | LiteralValue[] | undefined;
        if (filter.value?.kind === 'literal') value = filter.value.value;
        else if (supplied.has(i)) value = supplied.get(i);

        if (value === undefined) {
            exact = false;
            warnings.push(
                `Ignored filter on "${filter.field}": its value is only known at runtime.`
            );
            return;
        }

        if (filter.operator === 'in') {
            const list = Array.isArray(value) ? value : [value];
            params.push(list);
            conditions.push(`${col} = ANY($${params.length})`);
            return;
        }
        if (Array.isArray(value)) {
            exact = false;
            warnings.push(`Ignored filter on "${filter.field}": expected a single value.`);
            return;
        }
        if (value === null) {
            // Comparing with NULL never matches; mirror SQL semantics explicitly.
            if (filter.operator === 'eq') conditions.push(`${col} IS NULL`);
            else if (filter.operator === 'neq') conditions.push(`${col} IS NOT NULL`);
            else conditions.push('FALSE');
            return;
        }
        params.push(value);
        conditions.push(`${col} ${COMPARISON[filter.operator]} $${params.length}`);
    });

    const baseWhere = conditions.length > 0 ? conditions.join(' AND ') : 'TRUE';
    const queries: PlannedQuery[] = [
        {
            sql: `SELECT count(*) AS n FROM ${quoteTable(table.schema, table.name)} WHERE ${baseWhere}`,
            table: tableId(table),
            rule: 'BASE',
            depth: 0,
        },
    ];

    const isTruncate = mutation.operation === 'truncate';
    if (isDelete(mutation) || isTruncate) {
        const visited = new Map<string, number>();
        const walk = (parent: TableInfo, predicate: string, path: Set<string>, depth: number) => {
            for (const fk of index.referencing(parent)) {
                const child = index.get(fk.schema, fk.table);
                if (!child) continue;
                const childId = tableId(child);
                if (path.has(childId)) {
                    cascadeApproximate = true; // recursive deletes in the same table are not counted
                    warnings.push(
                        `Self-referencing / cyclic foreign key ${childId}(${fk.columns.join(', ')}) is not followed.`
                    );
                    continue;
                }
                if (queries.length >= MAX_SIMULATION_QUERIES || depth > MAX_SIMULATION_DEPTH) {
                    cascadeApproximate = true;
                    warnings.push('Cascade analysis stopped at the depth/size limit.');
                    return;
                }

                const rule: FkRule = isTruncate
                    ? mutation.truncateCascade
                        ? 'CASCADE'
                        : 'RESTRICT'
                    : fk.onDelete;
                const childPredicate = isTruncate
                    ? 'TRUE'
                    : `${columnList(fk.columns)} IN (SELECT ${fk.refColumns
                          .map(quoteIdent)
                          .join(
                              ', '
                          )} FROM ${quoteTable(parent.schema, parent.name)} WHERE ${predicate})`;

                queries.push({
                    sql: `SELECT count(*) AS n FROM ${quoteTable(child.schema, child.name)} WHERE ${childPredicate}`,
                    table: childId,
                    rule,
                    depth,
                });
                visited.set(childId, (visited.get(childId) ?? 0) + 1);

                if (rule === 'CASCADE') {
                    walk(child, childPredicate, new Set(path).add(childId), depth + 1);
                }
            }
        };
        walk(table, baseWhere, new Set([tableId(table)]), 1);

        for (const [id, count] of visited) {
            if (count > 1) {
                cascadeApproximate = true; // overlapping paths may be counted twice
                warnings.push(
                    `${id} is reached through ${count} foreign-key paths; rows matching several paths are counted more than once.`
                );
            }
        }
    }

    return { queries, params, exact, cascadeApproximate, warnings: [...new Set(warnings)] };
}

function columnList(columns: string[]): string {
    const quoted = columns.map(quoteIdent);
    return quoted.length === 1 ? quoted[0] : `(${quoted.join(', ')})`;
}
