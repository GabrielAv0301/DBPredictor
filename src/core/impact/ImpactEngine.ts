import type { EstimateKind, ImpactSummary, RiskLevel } from '../../shared/types';
import { mutationKey, type MutationInfo } from '../detectors/types';
import type { ProjectModel } from '../project/ProjectModel';
import { resolveTable } from '../schema/resolver';
import { tableId, type SchemaIndex, type TableInfo } from '../schema/types';
import { estimateDeleteCascade, estimateTruncate, type CascadeEstimate } from './CascadeAnalyzer';
import { describeFilter } from './describe';

export interface ImpactOptions {
    /** Total affected rows above which a mutation is CRITICAL. */
    criticalRowThreshold: number;
}

export const DEFAULT_IMPACT_OPTIONS: ImpactOptions = { criticalRowThreshold: 10_000 };

export interface ImpactContext {
    index: SchemaIndex | null;
    project: ProjectModel;
    options: ImpactOptions;
    /** Workspace-relative file name, for display. */
    file: string;
}

export interface ImpactAnalysis {
    mutation: MutationInfo;
    /** Resolved database table, when connected and found. */
    table: TableInfo | undefined;
    summary: ImpactSummary;
}

const EMPTY_CASCADE: CascadeEstimate = {
    nodes: [],
    deletedRows: 0,
    nullifiedRows: 0,
    blockers: [],
    truncated: false,
};

export function isBulk(m: Pick<MutationInfo, 'operation'>): boolean {
    return (
        m.operation === 'deleteMany' || m.operation === 'updateMany' || m.operation === 'truncate'
    );
}

export function isDelete(m: Pick<MutationInfo, 'operation'>): boolean {
    return m.operation === 'delete' || m.operation === 'deleteMany';
}

/** Unfiltered bulk mutations hit every row: dangerous regardless of the database. */
export function isUnfilteredBulk(m: Pick<MutationInfo, 'operation' | 'hasWhere'>): boolean {
    return m.operation === 'truncate' || (isBulk(m) && !m.hasWhere);
}

const fmt = (n: number) => n.toLocaleString('en-US');

/**
 * Computes the impact of a mutation from static analysis plus (optionally)
 * database statistics. Pure and synchronous: runs on every keystroke.
 */
export function analyzeImpact(mutation: MutationInfo, ctx: ImpactContext): ImpactAnalysis {
    const reasons: string[] = [];
    const resolution = ctx.index ? resolveTable(mutation.table, ctx.index, ctx.project) : undefined;
    const table = resolution?.table;
    const unfiltered = isUnfilteredBulk(mutation);
    const verb = isDelete(mutation) || mutation.operation === 'truncate' ? 'deletes' : 'updates';

    let baseRows: number | null = null;
    let baseEstimate: EstimateKind = 'unknown';
    let cascade = EMPTY_CASCADE;

    if (mutation.operation === 'delete' || mutation.operation === 'update') {
        baseRows = 1;
        baseEstimate = 'at-most-one';
    } else if (table) {
        baseRows = table.rowEstimate;
        baseEstimate = unfiltered ? 'estimated' : 'upper-bound';
    }

    if (table && ctx.index && baseRows !== null) {
        if (mutation.operation === 'truncate') {
            cascade = estimateTruncate(ctx.index, table, mutation.truncateCascade ?? false);
        } else if (isDelete(mutation)) {
            cascade = estimateDeleteCascade(ctx.index, table, baseRows);
        }
    }

    const totalRows =
        baseRows === null ? null : baseRows + cascade.deletedRows + cascade.nullifiedRows;

    // ---- Risk classification -------------------------------------------------
    let riskLevel: RiskLevel;
    if (unfiltered) {
        riskLevel = 'DESTRUCTIVE';
        reasons.push(
            mutation.operation === 'truncate'
                ? 'TRUNCATE removes every row of the table.'
                : `No filter: ${verb} every row of the table.`
        );
    } else if (!ctx.index || !table) {
        riskLevel = 'UNKNOWN';
    } else if (baseEstimate === 'upper-bound') {
        riskLevel = 'WARNING';
        reasons.push(
            mutation.filtersComplete
                ? `Bulk ${verb.replace(/s$/, '')} with a filter: up to ${fmt(totalRows ?? 0)} rows. Run the simulation for the exact count.`
                : `Bulk ${verb.replace(/s$/, '')}: some filter conditions could not be analysed.`
        );
    } else {
        const sideEffects = cascade.deletedRows + cascade.nullifiedRows;
        if (sideEffects > ctx.options.criticalRowThreshold) riskLevel = 'CRITICAL';
        else if (sideEffects > 0) riskLevel = 'WARNING';
        else riskLevel = 'SAFE';
        if (sideEffects > 0) {
            reasons.push(`Cascades to ~${fmt(sideEffects)} rows in related tables.`);
        }
    }

    if (
        totalRows !== null &&
        totalRows > ctx.options.criticalRowThreshold &&
        baseEstimate !== 'upper-bound' &&
        riskLevel !== 'DESTRUCTIVE'
    ) {
        riskLevel = 'CRITICAL';
    }

    if (ctx.index && !table && mutation.table.kind !== 'unknown') {
        reasons.push(
            `Table not found in the connected database (tried: ${resolution?.tried.join(', ') || mutation.table.name}).`
        );
    }
    if (mutation.table.kind === 'unknown') {
        reasons.push('The table name is built at runtime and cannot be analysed.');
    }
    if (cascade.blockers.length > 0) {
        reasons.push(
            mutation.operation === 'truncate'
                ? `Will fail: referenced by ${cascade.blockers.join(', ')} (use TRUNCATE … CASCADE).`
                : `May fail: rows in ${cascade.blockers.join(', ')} reference these rows (RESTRICT / NO ACTION).`
        );
    }
    if (cascade.truncated) reasons.push('Cascade analysis stopped at the depth/size limit.');
    if (mutation.orm === 'raw-sql' && mutation.hasWhere) {
        reasons.push('Raw SQL filters are not analysed; the row count is an upper bound.');
    }

    const summary: ImpactSummary = {
        key: mutationKey(mutation),
        orm: mutation.orm,
        operation: mutation.operation,
        tableInCode: mutation.table.name,
        table: table ? tableId(table) : null,
        connected: ctx.index !== null,
        hasWhere: mutation.hasWhere,
        filtersComplete: mutation.filtersComplete,
        filters: mutation.filters.map(describeFilter),
        tableRows: table ? table.rowEstimate : null,
        statsAnalyzedAt: table?.lastAnalyzed ?? null,
        baseRows,
        baseEstimate,
        cascadeDeletedRows: cascade.deletedRows,
        nullifiedRows: cascade.nullifiedRows,
        totalRows,
        cascade: cascade.nodes,
        blockers: cascade.blockers,
        riskLevel,
        reasons,
        file: ctx.file,
        line: mutation.range.start.line,
        sourceText:
            mutation.sourceText.length > 2000
                ? `${mutation.sourceText.slice(0, 2000)}…`
                : mutation.sourceText,
    };

    return { mutation, table, summary };
}
