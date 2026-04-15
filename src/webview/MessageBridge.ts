import { ImpactResult } from '../core/impact/types';
import { HistoryEntry } from '../core/impact/HistoryManager';

// IMPORTANT: Keep in sync with webview-ui/src/types/shared.ts
// Any changes here must be mirrored there manually.

export type WebviewMessage = 
    | { type: 'UPDATE_IMPACT'; data: ImpactResult }
    | { type: 'UPDATE_HISTORY'; data: HistoryEntry[] }
    | { type: 'SIMULATION_RESULT'; rowCount: number; error?: string }
    | { type: 'WEBVIEW_READY' };

export type ExtensionMessage = 
    | { type: 'GET_HISTORY' }
    | { type: 'CLEAR_HISTORY' }
    | { type: 'SIMULATE'; data: ImpactResult }
    | { type: 'WEBVIEW_READY' };
