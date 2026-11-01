import * as vscode from 'vscode';
import type { AnalysisService } from '../services/AnalysisService';
import { Settings } from '../services/settings';
import { COMMANDS, lensTitle, type MutationTarget } from './format';

export class ImpactCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
    private readonly emitter = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses = this.emitter.event;
    private readonly subscription: { dispose(): void };

    constructor(private readonly analysis: AnalysisService) {
        this.subscription = analysis.onDidChange(() => this.emitter.fire());
    }

    public refresh(): void {
        this.emitter.fire();
    }

    public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        if (!Settings.enabled || !Settings.showCodeLens) return [];
        const result = this.analysis.analyze(document);
        if (!result) return [];

        const lenses: vscode.CodeLens[] = [];
        for (const impact of result.impacts) {
            if (impact.mutation.ignored) continue;
            const { start } = impact.mutation.range;
            const range = new vscode.Range(
                start.line,
                start.character,
                start.line,
                start.character
            );
            const s = impact.summary;
            const target: MutationTarget = { uri: result.uri, key: s.key };

            if (!s.connected && s.riskLevel !== 'DESTRUCTIVE') {
                lenses.push(
                    new vscode.CodeLens(range, { title: lensTitle(s), command: COMMANDS.connect })
                );
                continue;
            }
            lenses.push(
                new vscode.CodeLens(range, {
                    title: lensTitle(s),
                    tooltip: [...s.reasons, 'Click for details.'].join('\n'),
                    command: COMMANDS.showImpactPanel,
                    arguments: [target],
                })
            );
            if (s.connected && s.table) {
                lenses.push(
                    new vscode.CodeLens(range, {
                        title: '$(play) Count exactly',
                        tooltip:
                            'Count the affected rows with read-only SELECT count(*) queries. Nothing is modified.',
                        command: COMMANDS.simulate,
                        arguments: [target],
                    })
                );
            } else if (!s.connected) {
                lenses.push(
                    new vscode.CodeLens(range, {
                        title: '$(plug) Connect for row estimates',
                        command: COMMANDS.connect,
                    })
                );
            }
        }
        return lenses;
    }

    public dispose(): void {
        this.subscription.dispose();
        this.emitter.dispose();
    }
}
