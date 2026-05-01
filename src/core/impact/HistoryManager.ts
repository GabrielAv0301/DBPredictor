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

    private generateId(): string {
        const radix = 36;
        const substringStart = 2;
        const substringEnd = 9;
        return `${Date.now()}-${Math.random().toString(radix).substring(substringStart, substringEnd)}`;
    }

    public save(impact: ImpactResult, document: vscode.TextDocument): HistoryEntry[] {
        const history = this.getHistory();

        const newEntry: HistoryEntry = {
            id: this.generateId(),
            timestamp: Date.now(),
            impact,
            fileName: document.fileName,
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

    public exportToJSON(): string {
        const history = this.getHistory();
        return JSON.stringify(history, null, 2);
    }

    public exportToCSV(): string {
        const headers =
            'id,timestamp,table,operation,riskLevel,baseRowsAffected,totalRowsAffected,fileName\n';
        const rows = this.getHistory().map((e) =>
            [
                e.id,
                new Date(e.timestamp).toISOString(),
                e.impact.table,
                e.impact.operation,
                e.impact.riskLevel,
                e.impact.baseRowsAffected,
                e.impact.totalRowsAffected,
                `"${e.fileName}"`,
            ].join(',')
        );
        return headers + rows.join('\n');
    }
}
