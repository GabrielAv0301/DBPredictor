/**
 * Shared types between the VS Code extension and the Webview UI.
 * This file is the single source of truth for communication and data structures.
 */

// --- Base Types ---

export type RiskLevel = 'SAFE' | 'WARNING' | 'CRITICAL' | 'DESTRUCTIVE';
export type EstimationQuality = 'exact' | 'worst-case' | 'estimated';
export type MutationOperation = 'deleteMany' | 'updateMany' | 'delete' | 'update';

// --- Data Structures ---

export interface CascadeResult {
    table: string;
    rowsEstimated: number;
    rule: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
    children: CascadeResult[];
}

export interface ImpactResult {
    table: string;
    operation: MutationOperation;
    hasWhere: boolean;
    whereClause?: string;
    queryParams?: { column: string; value: unknown }[];
    baseRowsAffected: number;
    totalRowsAffected: number;
    tableTotalRows: number;
    estimationQuality: EstimationQuality;
    riskLevel: RiskLevel;
    cascadeChain: CascadeResult[];
    willFailByRestrict: boolean;
    statsLastUpdated?: string | null;
}

export interface HistoryEntry {
    id: string;
    timestamp: number;
    impact: ImpactResult;
    fileName: string;
}

// --- Communication Protocol ---

/** Messages sent from the Extension to the Webview */
export type WebviewMessage =
    | { type: 'UPDATE_IMPACT'; data: ImpactResult }
    | { type: 'UPDATE_HISTORY'; data: HistoryEntry[] }
    | { type: 'SIMULATION_RESULT'; rowCount: number; warnCascade?: string; error?: string }
    | { type: 'CONNECTION_STATUS'; data: { isConnected: boolean } }
    | { type: 'WEBVIEW_READY' };

/** Messages sent from the Webview to the Extension */
export type ExtensionMessage =
    | { type: 'GET_HISTORY' }
    | { type: 'CLEAR_HISTORY' }
    | { type: 'EXPORT_HISTORY'; format: 'json' | 'csv' }
    | { type: 'SIMULATE'; data: ImpactResult }
    | { type: 'RECONNECT_PROMPT' }
    | { type: 'WEBVIEW_READY' };
