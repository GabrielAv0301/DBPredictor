// Types shared between the VS Code extension and the Webview UI
// IMPORTANT: Keep in sync with src/webview/MessageBridge.ts
// Any changes here must be mirrored there manually.

export type RiskLevel = 'SAFE' | 'WARNING' | 'CRITICAL' | 'DESTRUCTIVE';
export type EstimationQuality = 'exact' | 'worst-case' | 'estimated';
export type MutationOperation = 'deleteMany' | 'updateMany' | 'delete' | 'update';

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
    baseRowsAffected: number;
    totalRowsAffected: number;
    tableTotalRows: number;
    estimationQuality: EstimationQuality;
    riskLevel: RiskLevel;
    cascadeChain: CascadeResult[];
    willFailByRestrict: boolean;
}

export interface HistoryEntry {
    id: string;
    timestamp: number;
    impact: ImpactResult;
    fileName: string;
}

// Message types (mirrors src/webview/MessageBridge.ts)
export type WebviewMessage =
    | { type: 'UPDATE_IMPACT'; data: ImpactResult }
    | { type: 'UPDATE_HISTORY'; data: HistoryEntry[] }
    | { type: 'SIMULATION_RESULT'; rowCount: number; error?: string }
    | { type: 'WEBVIEW_READY' }; // Internal to webview lifecycle

export type ExtensionMessage =
    | { type: 'GET_HISTORY' }
    | { type: 'CLEAR_HISTORY' }
    | { type: 'SIMULATE'; data: ImpactResult }
    | { type: 'WEBVIEW_READY' };
