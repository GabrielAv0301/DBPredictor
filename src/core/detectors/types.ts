import type { MutationOperation, Orm } from '../../shared/types';

export interface Position {
    line: number;
    character: number;
}

export interface SourceRange {
    start: Position;
    end: Position;
}

export type FilterOperator =
    'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'like' | 'ilike' | 'isNull' | 'isNotNull';

export type LiteralValue = string | number | boolean | null;

export type FilterValue =
    /** A value known statically from the source code. */
    | { kind: 'literal'; value: LiteralValue | LiteralValue[] }
    /** A runtime expression (variable, call…). Its value must be supplied by the user to simulate. */
    | { kind: 'expression'; text: string };

export interface FilterCondition {
    /** Column / field name as written in code (Prisma field, Drizzle property, SQL column). */
    field: string;
    operator: FilterOperator;
    /** Absent for `isNull` / `isNotNull`. */
    value?: FilterValue;
}

export type TableRef =
    | { kind: 'prisma-model'; name: string }
    | { kind: 'drizzle-variable'; name: string }
    | { kind: 'sql-name'; name: string; schema?: string }
    | { kind: 'unknown'; name: string };

export interface MutationInfo {
    orm: Orm;
    operation: MutationOperation;
    table: TableRef;
    /** True when the statement restricts the affected rows in any way. */
    hasWhere: boolean;
    /**
     * Conjunctive (AND-ed) conditions that could be translated.
     * When `filtersComplete` is false, some conditions were dropped, so a count
     * using `filters` is an upper bound of the real number of rows.
     */
    filters: FilterCondition[];
    filtersComplete: boolean;
    /** TRUNCATE … CASCADE */
    truncateCascade?: boolean;
    range: SourceRange;
    sourceText: string;
    /** Suppressed with a `queryguard-ignore` comment. */
    ignored: boolean;
}

export interface DetectorOptions {
    prismaClientNames: readonly string[];
    drizzleClientNames: readonly string[];
    /** Returns true when the identifier is a known Drizzle table (from the project index). */
    isKnownDrizzleTable?: (variableName: string) => boolean;
}

export const DEFAULT_DETECTOR_OPTIONS: DetectorOptions = {
    prismaClientNames: ['prisma', 'db', 'tx', 'client', 'prismaClient', 'database'],
    drizzleClientNames: ['db', 'tx', 'database', 'orm', 'client', 'drizzle'],
};

export function mutationKey(m: Pick<MutationInfo, 'orm' | 'operation' | 'range'>): string {
    return `${m.orm}:${m.operation}:${m.range.start.line}:${m.range.start.character}`;
}
