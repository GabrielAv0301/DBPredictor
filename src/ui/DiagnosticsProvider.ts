import * as vscode from 'vscode';
import { IGNORE_DIRECTIVE } from '../core/detectors';
import type { ImpactAnalysis } from '../core/impact/ImpactEngine';
import type { AnalysisService } from '../services/AnalysisService';
import { Settings, type DiagnosticSeverityName } from '../services/settings';
import { COMMANDS, formatCount, type MutationTarget } from './format';

const SEVERITY: Record<Exclude<DiagnosticSeverityName, 'none'>, vscode.DiagnosticSeverity> = {
    error: vscode.DiagnosticSeverity.Error,
    warning: vscode.DiagnosticSeverity.Warning,
    information: vscode.DiagnosticSeverity.Information,
    hint: vscode.DiagnosticSeverity.Hint,
};

const README = 'https://github.com/GabrielAv0301/DBPredictor#risk-levels';

function message(impact: ImpactAnalysis): string {
    const s = impact.summary;
    const target = s.table ?? s.tableInCode;
    if (s.riskLevel === 'DESTRUCTIVE') {
        const rows =
            s.totalRows !== null ? ` (~${formatCount(s.totalRows)} rows incl. cascades)` : '';
        return s.operation === 'truncate'
            ? `TRUNCATE empties ${target}${rows}.`
            : `${s.operation} without a filter affects every row of ${target}${rows}.`;
    }
    return `${s.operation} on ${target} affects ~${formatCount(s.totalRows ?? 0)} rows including foreign-key cascades.`;
}

/**
 * Publishes diagnostics for DESTRUCTIVE / CRITICAL mutations and offers quick
 * fixes (details, exact count, ignore).
 */
export class DiagnosticsProvider implements vscode.CodeActionProvider, vscode.Disposable {
    public static readonly metadata: vscode.CodeActionProviderMetadata = {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    };

    private readonly collection = vscode.languages.createDiagnosticCollection('queryguard');
    private readonly subscription: { dispose(): void };

    constructor(private readonly analysis: AnalysisService) {
        this.subscription = analysis.onDidChange((uri) => {
            if (uri) {
                const document = vscode.workspace.textDocuments.find(
                    (d) => d.uri.toString() === uri
                );
                if (document) this.publish(document);
                else this.collection.delete(vscode.Uri.parse(uri));
            } else {
                this.collection.clear();
                vscode.workspace.textDocuments.forEach((d) => this.publish(d));
            }
        });
    }

    public publish(document: vscode.TextDocument): void {
        const severity = Settings.diagnosticSeverity;
        const result = this.analysis.get(document.uri);
        if (!Settings.enabled || severity === 'none' || !result) {
            this.collection.delete(document.uri);
            return;
        }
        const diagnostics: vscode.Diagnostic[] = [];
        for (const impact of result.impacts) {
            const risk = impact.summary.riskLevel;
            if (impact.mutation.ignored || (risk !== 'DESTRUCTIVE' && risk !== 'CRITICAL'))
                continue;
            const { start, end } = impact.mutation.range;
            const range = new vscode.Range(start.line, start.character, end.line, end.character);
            const diagnostic = new vscode.Diagnostic(range, message(impact), SEVERITY[severity]);
            diagnostic.source = 'QueryGuard';
            diagnostic.code = {
                value: risk === 'DESTRUCTIVE' ? 'destructive-mutation' : 'critical-impact',
                target: vscode.Uri.parse(README),
            };
            diagnostics.push(diagnostic);
        }
        this.collection.set(document.uri, diagnostics);
    }

    public clear(document?: vscode.TextDocument): void {
        if (document) this.collection.delete(document.uri);
        else this.collection.clear();
    }

    public provideCodeActions(
        document: vscode.TextDocument,
        _range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext
    ): vscode.CodeAction[] {
        const ours = context.diagnostics.filter((d) => d.source === 'QueryGuard');
        if (ours.length === 0) return [];
        const result = this.analysis.get(document.uri);
        if (!result) return [];

        const actions: vscode.CodeAction[] = [];
        for (const diagnostic of ours) {
            const impact = result.impacts.find(
                (i) =>
                    i.mutation.range.start.line === diagnostic.range.start.line &&
                    i.mutation.range.start.character === diagnostic.range.start.character
            );
            if (!impact) continue;
            const target: MutationTarget = { uri: result.uri, key: impact.summary.key };

            const details = new vscode.CodeAction(
                'QueryGuard: Show impact analysis',
                vscode.CodeActionKind.QuickFix
            );
            details.command = {
                title: 'Show impact analysis',
                command: COMMANDS.showImpactPanel,
                arguments: [target],
            };
            details.diagnostics = [diagnostic];
            actions.push(details);

            if (impact.summary.connected && impact.summary.table) {
                const count = new vscode.CodeAction(
                    'QueryGuard: Count affected rows (read-only)',
                    vscode.CodeActionKind.QuickFix
                );
                count.command = {
                    title: 'Count affected rows',
                    command: COMMANDS.simulate,
                    arguments: [target],
                };
                count.diagnostics = [diagnostic];
                actions.push(count);
            }

            const ignore = new vscode.CodeAction(
                'QueryGuard: Ignore this mutation',
                vscode.CodeActionKind.QuickFix
            );
            const line = document.lineAt(impact.mutation.range.start.line);
            const indent = line.text.slice(0, line.firstNonWhitespaceCharacterIndex);
            ignore.edit = new vscode.WorkspaceEdit();
            ignore.edit.insert(
                document.uri,
                new vscode.Position(line.lineNumber, 0),
                `${indent}// ${IGNORE_DIRECTIVE}\n`
            );
            ignore.diagnostics = [diagnostic];
            actions.push(ignore);
        }
        return actions;
    }

    public dispose(): void {
        this.subscription.dispose();
        this.collection.dispose();
    }
}
