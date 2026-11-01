/**
 * Types shared between the extension host and the webview.
 *
 * Everything in this file must stay serialisable (plain JSON): it crosses the
 * webview `postMessage` boundary and is persisted in workspace state.
 */

export type RiskLevel = 'SAFE' | 'WARNING' | 'CRITICAL' | 'DESTRUCTIVE' | 'UNKNOWN';

export type Orm = 'prisma' | 'supabase' | 'drizzle' | 'raw-sql';

export type MutationOperation = 'delete' | 'update' | 'deleteMany' | 'updateMany' | 'truncate';

export type FkRule = 'CASCADE' | 'SET NULL' | 'SET DEFAULT' | 'RESTRICT' | 'NO ACTION';

/**
 * How trustworthy a row count is.
 * - `exact`        counted with a real query.
 * - `estimated`    derived from PostgreSQL planner statistics.
 * - `upper-bound`  the real value is lower or equal (e.g. filtered mutation, filter unknown).
 * - `at-most-one`  single-record operation (`delete` / `update` by unique key).
 * - `unknown`      no database information available.
 */
export type EstimateKind = 'exact' | 'estimated' | 'upper-bound' | 'at-most-one' | 'unknown';

export interface CascadeNode {
    /** Qualified table name (`schema.table`). */
    table: string;
    /** Referencing columns, e.g. `author_id`. */
    columns: string[];
    rule: FkRule;
    rowsEstimated: number;
    /** True when the edge points back to a table already on the path (self reference / cycle). */
    cyclic: boolean;
    children: CascadeNode[];
}

export interface ImpactSummary {
    /** Stable key of the mutation inside its document. */
    key: string;
    orm: Orm;
    operation: MutationOperation;
    /** Table as written in code (model, variable or SQL name). */
    tableInCode: string;
    /** Resolved database table (`schema.table`), or null when not resolved. */
    table: string | null;
    connected: boolean;
    hasWhere: boolean;
    filtersComplete: boolean;
    /** Human readable filter description, e.g. `id = 42`, `email = ‹userEmail›`. */
    filters: string[];
    tableRows: number | null;
    statsAnalyzedAt: string | null;
    baseRows: number | null;
    baseEstimate: EstimateKind;
    cascadeDeletedRows: number;
    nullifiedRows: number;
    totalRows: number | null;
    cascade: CascadeNode[];
    /** Tables whose RESTRICT / NO ACTION foreign keys may make the statement fail. */
    blockers: string[];
    riskLevel: RiskLevel;
    /** Short human readable explanations of the risk level. */
    reasons: string[];
    /** Workspace-relative file path. */
    file: string;
    /** Zero-based line of the mutation. */
    line: number;
    sourceText: string;
}

export interface SimulationCount {
    table: string;
    rule: FkRule | 'BASE';
    depth: number;
    rows: number;
}

export interface SimulationReport {
    ok: boolean;
    error?: string;
    /** Rows matched by the statement itself. */
    baseRows: number;
    /** Base count is exact: every filter was translated and all values were known. */
    exact: boolean;
    /** Cascade totals are approximate (self references, depth limit, overlapping paths). */
    cascadeApproximate?: boolean;
    counts: SimulationCount[];
    cascadeDeletedRows: number;
    nullifiedRows: number;
    /** Tables that contain rows referencing the deleted rows through RESTRICT / NO ACTION. */
    blockedBy: { table: string; rows: number }[];
    warnings: string[];
    durationMs: number;
    finishedAt: number;
}

export interface HistoryEntry {
    id: string;
    timestamp: number;
    impact: ImpactSummary;
    simulation?: SimulationReport;
}

export interface ConnectionInfo {
    connected: boolean;
    profileName?: string;
}

/** Messages sent from the extension to the webview. */
export type ToWebviewMessage =
    | { type: 'impact'; impact: ImpactSummary | null; connection: ConnectionInfo }
    | { type: 'history'; entries: HistoryEntry[] }
    | { type: 'connection'; connection: ConnectionInfo }
    | { type: 'simulationStarted' }
    | { type: 'simulationFinished'; report: SimulationReport };

/** Messages sent from the webview to the extension. */
export type FromWebviewMessage =
    | { type: 'ready' }
    | { type: 'simulate' }
    | { type: 'connect' }
    | { type: 'revealSource' }
    | { type: 'clearHistory' }
    | { type: 'exportHistory'; format: 'json' | 'csv' };

const FROM_WEBVIEW_TYPES = new Set([
    'ready',
    'simulate',
    'connect',
    'revealSource',
    'clearHistory',
    'exportHistory',
]);

/** Runtime validation of messages coming from the webview (never trust the other side). */
export function isFromWebviewMessage(value: unknown): value is FromWebviewMessage {
    if (typeof value !== 'object' || value === null) return false;
    const type = (value as { type?: unknown }).type;
    if (typeof type !== 'string' || !FROM_WEBVIEW_TYPES.has(type)) return false;
    if (type === 'exportHistory') {
        const format = (value as { format?: unknown }).format;
        return format === 'json' || format === 'csv';
    }
    return true;
}
