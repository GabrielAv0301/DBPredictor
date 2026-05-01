import * as vscode from 'vscode';
import { SchemaCache } from '../core/db/SchemaCache';
import { PrismaDetector } from '../core/detectors/PrismaDetector';
import { SupabaseDetector } from '../core/detectors/SupabaseDetector';
import { DrizzleDetector } from '../core/detectors/DrizzleDetector';
import { ImpactEngine } from '../core/impact/ImpactEngine';

export class DiagnosticProvider implements vscode.CodeActionProvider {
    private collection: vscode.DiagnosticCollection;
    private prismaDetector = new PrismaDetector();
    private supabaseDetector = new SupabaseDetector();
    private drizzleDetector = new DrizzleDetector();

    constructor() {
        this.collection = vscode.languages.createDiagnosticCollection('queryguard');
    }

    public update(document: vscode.TextDocument) {
        const config = vscode.workspace.getConfiguration('queryguard');
        if (!config.get<boolean>('enabled', true)) {
            this.collection.clear();
            return;
        }

        const supportedLanguages = [
            'typescript',
            'typescriptreact',
            'javascript',
            'javascriptreact',
        ];
        if (!supportedLanguages.includes(document.languageId)) {
            return;
        }

        const schema = SchemaCache.getInstance().getData();
        if (!schema) return;

        const allMutations = [
            ...this.prismaDetector.detect(document),
            ...this.supabaseDetector.detect(document),
            ...this.drizzleDetector.detect(document),
        ];

        const diagnostics: vscode.Diagnostic[] = [];

        for (const m of allMutations) {
            const impact = ImpactEngine.calculate(m, schema);

            if (impact.riskLevel === 'DESTRUCTIVE' || impact.riskLevel === 'CRITICAL') {
                const range = new vscode.Range(
                    m.range.start.line,
                    m.range.start.character,
                    m.range.end.line,
                    m.range.end.character
                );

                const severity =
                    impact.riskLevel === 'DESTRUCTIVE'
                        ? vscode.DiagnosticSeverity.Error
                        : vscode.DiagnosticSeverity.Warning;

                const message =
                    impact.riskLevel === 'DESTRUCTIVE'
                        ? `[QueryGuard] DESTRUCTIVE: This mutation affects ALL rows in "${impact.table}" (${impact.totalRowsAffected.toLocaleString()} total)`
                        : `[QueryGuard] CRITICAL: This mutation impacts ~${impact.totalRowsAffected.toLocaleString()} rows across ${impact.cascadeChain.length} cascade level(s)`;

                const diagnostic = new vscode.Diagnostic(range, message, severity);
                diagnostic.source = 'QueryGuard';
                diagnostic.code = impact.riskLevel;
                diagnostics.push(diagnostic);
            }
        }

        this.collection.set(document.uri, diagnostics);
    }

    public provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection
    ): vscode.CodeAction[] {
        const diagnostics = this.collection.get(document.uri);
        if (!diagnostics) return [];

        const relevantDiagnostic = diagnostics.find((d) => d.range.intersection(range));
        if (!relevantDiagnostic) return [];

        const simulateAction = new vscode.CodeAction(
            'QueryGuard: Run Safe Simulation',
            vscode.CodeActionKind.QuickFix
        );
        simulateAction.command = {
            title: 'Run Safe Simulation',
            command: 'queryguard.simulate',
            arguments: [undefined], // Ideally we pass the impact, but we need to retrieve it
        };

        const showImpactAction = new vscode.CodeAction(
            'QueryGuard: Show Impact Analysis',
            vscode.CodeActionKind.QuickFix
        );
        showImpactAction.command = {
            title: 'Show Impact Analysis',
            command: 'queryguard.showImpactPanel',
            arguments: [undefined],
        };

        return [simulateAction, showImpactAction];
    }

    public clear() {
        this.collection.clear();
    }
}
