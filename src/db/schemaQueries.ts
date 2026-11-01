import type { FkRule } from '../shared/types';
import type { ForeignKeyInfo, SchemaSnapshot, TableInfo } from '../core/schema/types';

/**
 * Catalog queries. They read pg_catalog directly (not information_schema) so
 * that results are schema-aware, include multi-column foreign keys and work
 * without per-table privileges.
 */

const SYSTEM_SCHEMA_FILTER = `n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg\\_toast%'
      AND n.nspname NOT LIKE 'pg\\_temp\\_%'`;

export const TABLES_SQL = `
SELECT n.nspname::text AS "schema",
       c.relname::text AS "name",
       c.relkind::text AS "kind",
       COALESCE(s.n_live_tup, 0)::float8 AS "liveTuples",
       c.reltuples::float8 AS "relTuples",
       CASE WHEN c.relkind = 'p' THEN (
           SELECT COALESCE(SUM(GREATEST(ch.reltuples, 0)), 0)::float8
           FROM pg_inherits i JOIN pg_class ch ON ch.oid = i.inhrelid
           WHERE i.inhparent = c.oid)
       END AS "partitionTuples",
       GREATEST(s.last_analyze, s.last_autoanalyze) AS "lastAnalyzed",
       ARRAY(SELECT a.attname::text FROM pg_attribute a
             WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
             ORDER BY a.attnum) AS "columns"
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_stat_all_tables s ON s.relid = c.oid
WHERE c.relkind IN ('r', 'p')
  AND NOT c.relispartition
  AND ${SYSTEM_SCHEMA_FILTER}`;

export const FOREIGN_KEYS_SQL = `
SELECT con.conname::text AS "name",
       n.nspname::text AS "schema",
       cl.relname::text AS "table",
       fn.nspname::text AS "refSchema",
       fcl.relname::text AS "refTable",
       con.confdeltype::text AS "deleteType",
       ARRAY(SELECT a.attname::text
             FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
             JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
             ORDER BY k.ord) AS "columns",
       ARRAY(SELECT a.attname::text
             FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord)
             JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum
             ORDER BY k.ord) AS "refColumns"
FROM pg_constraint con
JOIN pg_class cl ON cl.oid = con.conrelid
JOIN pg_namespace n ON n.oid = cl.relnamespace
JOIN pg_class fcl ON fcl.oid = con.confrelid
JOIN pg_namespace fn ON fn.oid = fcl.relnamespace
WHERE con.contype = 'f'
  AND ${SYSTEM_SCHEMA_FILTER}
  AND con.conparentid = 0`;

export const SEARCH_PATH_SQL = `SELECT current_schemas(false)::text[] AS "searchPath"`;

const DELETE_RULES: Record<string, FkRule> = {
    a: 'NO ACTION',
    r: 'RESTRICT',
    c: 'CASCADE',
    n: 'SET NULL',
    d: 'SET DEFAULT',
};

export interface TableRow {
    schema: string;
    name: string;
    kind: string;
    liveTuples: number;
    relTuples: number;
    partitionTuples: number | null;
    lastAnalyzed: Date | string | null;
    columns: string[];
}

export interface ForeignKeyRow {
    name: string;
    schema: string;
    table: string;
    refSchema: string;
    refTable: string;
    deleteType: string;
    columns: string[];
    refColumns: string[];
}

/**
 * n_live_tup is maintained continuously by the stats collector; reltuples is
 * only refreshed by VACUUM/ANALYZE and is -1 for never-analysed tables.
 */
export function rowEstimate(
    row: Pick<TableRow, 'liveTuples' | 'relTuples' | 'partitionTuples'>
): number {
    const candidates = [row.liveTuples, row.relTuples, row.partitionTuples ?? 0]
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0);
    if (candidates.length === 0) return 0;
    // Prefer the live counter when present.
    return Math.round(row.liveTuples > 0 ? row.liveTuples : Math.max(...candidates));
}

export function toSnapshot(
    tables: TableRow[],
    foreignKeys: ForeignKeyRow[],
    searchPath: string[],
    fetchedAt = Date.now()
): SchemaSnapshot {
    return {
        tables: tables.map((t): TableInfo => ({
            schema: t.schema,
            name: t.name,
            rowEstimate: rowEstimate(t),
            lastAnalyzed:
                t.lastAnalyzed instanceof Date
                    ? t.lastAnalyzed.toISOString()
                    : (t.lastAnalyzed ?? null),
            columns: t.columns ?? [],
        })),
        foreignKeys: foreignKeys.map((fk): ForeignKeyInfo => ({
            name: fk.name,
            schema: fk.schema,
            table: fk.table,
            columns: fk.columns ?? [],
            refSchema: fk.refSchema,
            refTable: fk.refTable,
            refColumns: fk.refColumns ?? [],
            onDelete: DELETE_RULES[fk.deleteType] ?? 'NO ACTION',
        })),
        searchPath,
        fetchedAt,
    };
}
