import * as vscode from 'vscode';
import { ImpactResult } from './types';

export interface HistoryEntry {
    id: string;
    timestamp: number;
    impact: ImpactResult;
    fileName: string;
}

export class HistoryManager {
    private static readonly STORAGE_KEY = 'queryguard.history';
    private static readonly MAX_ENTRIES = 20;

    constructor(private context: vscode.ExtensionContext) {}

    public save(impact: ImpactResult, document: vscode.TextDocument): HistoryEntry[] {
        const history = this.getHistory();
        
        const newEntry: HistoryEntry = {
            id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            timestamp: Date.now(),
            impact,
            fileName: document.fileName
        };

        history.unshift(newEntry);
        
        // Trim history to max entries
        const trimmedHistory = history.slice(0, HistoryManager.MAX_ENTRIES);
        
        this.context.globalState.update(HistoryManager.STORAGE_KEY, trimmedHistory);
        return trimmedHistory;
    }

    public getHistory(): HistoryEntry[] {
        return this.context.globalState.get<HistoryEntry[]>(HistoryManager.STORAGE_KEY) || [];
    }

    public clear() {
        this.context.globalState.update(HistoryManager.STORAGE_KEY, []);
    }
}
