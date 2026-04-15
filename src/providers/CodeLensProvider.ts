import * as vscode from 'vscode';
import { MutationInfo } from '../core/detectors/DetectorInterface';
import { ImpactEngine } from '../core/impact/ImpactEngine';
import { SchemaCache } from '../core/db/SchemaCache';
import { RiskLevel } from '../core/impact/types';

export class CodeLensProvider implements vscode.CodeLensProvider {
    private mutations: Map<string, MutationInfo[]> = new Map();
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

    public setMutations(uri: string, mutations: MutationInfo[]) {
        this.mutations.set(uri, mutations);
        this._onDidChangeCodeLenses.fire();
    }

    public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        const config = vscode.workspace.getConfiguration('queryguard');
        if (!config.get<boolean>('enabled', true) || !config.get<boolean>('showCodeLens', true)) {
            return [];
        }

        const docMutations = this.mutations.get(document.uri.toString()) || [];
        const schema = SchemaCache.getInstance().getData();
        
        const lenses: vscode.CodeLens[] = [];
        for (const m of docMutations) {
            if (!schema) {
                // Show a helpful lens even when disconnected
                lenses.push(new vscode.CodeLens(m.range, {
                    title: '$(database) QueryGuard: Connect to database to see impact analysis',
                    command: 'queryguard.connect'
                }));
                continue;
            }

            const impact = ImpactEngine.calculate(m, schema);
            const icon = this.getRiskIcon(impact.riskLevel);
            const cascadeInfo = impact.cascadeChain.length > 0 
                ? ` · Cascade: ${impact.cascadeChain.map(c => `${c.table}(${c.rowsEstimated})`).join(', ')}` 
                : '';
            
            const restrictAlert = impact.willFailByRestrict ? ' · ⛔ WILL FAIL (Restrict)' : '';

            const rowsText = impact.estimationQuality === 'worst-case' 
                ? `Up to ~${impact.totalRowsAffected.toLocaleString()}` 
                : `~${impact.totalRowsAffected.toLocaleString()}`;
            
            const title = `${icon} ${rowsText} rows${cascadeInfo}${restrictAlert} · [Details]`;

            lenses.push(new vscode.CodeLens(m.range, {
                title,
                command: 'queryguard.showImpactPanel',
                arguments: [impact]
            }));
        }
        return lenses;
    }

    private getRiskIcon(risk: RiskLevel): string {
        switch (risk) {
            case 'DESTRUCTIVE': return '☠️';
            case 'CRITICAL': return '🔴';
            case 'WARNING': return '⚠️';
            default: return '✅';
        }
    }
}
