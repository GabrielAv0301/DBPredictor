import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import type { HistoryStore } from '../services/HistoryStore';
import {
    isFromWebviewMessage,
    type ConnectionInfo,
    type FromWebviewMessage,
    type ImpactSummary,
    type SimulationReport,
    type ToWebviewMessage,
} from '../shared/types';
import { Logger, redact } from '../utils/logger';
import { COMMANDS, type MutationTarget } from './format';

export interface PanelHost {
    connection(): ConnectionInfo;
    /** Re-run the simulation for the current mutation. */
    simulate(target: MutationTarget): void;
    reveal(target: MutationTarget): void;
}

/** Singleton webview panel showing the impact of one mutation plus history. */
export class ImpactPanel implements vscode.Disposable {
    private static current: ImpactPanel | undefined;
    private readonly disposables: vscode.Disposable[] = [];
    private target: MutationTarget | undefined;
    private impact: ImpactSummary | null = null;
    private simulation: SimulationReport | undefined;
    private simulating = false;
    private disposed = false;

    private constructor(
        private readonly panel: vscode.WebviewPanel,
        private readonly extensionUri: vscode.Uri,
        private readonly history: HistoryStore,
        private readonly host: PanelHost
    ) {
        panel.iconPath = vscode.Uri.joinPath(extensionUri, 'assets', 'icon.png');
        panel.webview.html = this.html();
        this.disposables.push(
            panel.onDidDispose(() => this.dispose()),
            panel.webview.onDidReceiveMessage((m: unknown) => this.onMessage(m))
        );
    }

    public static get instance(): ImpactPanel | undefined {
        return ImpactPanel.current;
    }

    public static show(
        extensionUri: vscode.Uri,
        history: HistoryStore,
        host: PanelHost,
        target: MutationTarget | undefined,
        impact: ImpactSummary | null
    ): ImpactPanel {
        if (!ImpactPanel.current) {
            const panel = vscode.window.createWebviewPanel(
                'queryguard.impact',
                'QueryGuard: Impact',
                { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
                {
                    enableScripts: true,
                    enableCommandUris: false,
                    localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'out', 'webview')],
                }
            );
            ImpactPanel.current = new ImpactPanel(panel, extensionUri, history, host);
        } else {
            ImpactPanel.current.panel.reveal(undefined, true);
        }
        ImpactPanel.current.setImpact(target, impact);
        return ImpactPanel.current;
    }

    /** Shows a mutation; keeps the previous simulation only if it's the same mutation. */
    public setImpact(target: MutationTarget | undefined, impact: ImpactSummary | null): void {
        const same =
            target &&
            this.target &&
            target.uri === this.target.uri &&
            target.key === this.target.key;
        if (!same) {
            this.simulation = undefined;
            this.simulating = false;
        }
        this.target = target;
        this.impact = impact;
        this.post({ type: 'impact', impact, connection: this.host.connection() });
        if (this.simulation) this.post({ type: 'simulationFinished', report: this.simulation });
    }

    /** Re-reads the shown mutation (after edits or a schema refresh) and pushes changes. */
    public refresh(lookup: (target: MutationTarget) => ImpactSummary | undefined): void {
        if (!this.target) return;
        const next = lookup(this.target);
        if (!next || JSON.stringify(next) === JSON.stringify(this.impact)) return;
        this.impact = next;
        this.post({ type: 'impact', impact: next, connection: this.host.connection() });
    }

    public isShowing(target: MutationTarget): boolean {
        return !!this.target && this.target.uri === target.uri && this.target.key === target.key;
    }

    public simulationStarted(): void {
        this.simulating = true;
        this.post({ type: 'simulationStarted' });
    }

    public simulationFinished(report: SimulationReport): void {
        this.simulating = false;
        this.simulation = report;
        this.post({ type: 'simulationFinished', report });
    }

    public connectionChanged(): void {
        this.post({ type: 'connection', connection: this.host.connection() });
    }

    public historyChanged(): void {
        this.post({ type: 'history', entries: this.history.list() });
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        ImpactPanel.current = undefined;
        this.panel.dispose();
        this.disposables.forEach((d) => d.dispose());
        this.disposables.length = 0;
    }

    private post(message: ToWebviewMessage): void {
        if (this.disposed) return; // the webview getter throws once disposed
        void this.panel.webview.postMessage(message);
    }

    private async onMessage(raw: unknown): Promise<void> {
        if (!isFromWebviewMessage(raw)) {
            Logger.warn('Ignored an invalid message from the webview.');
            return;
        }
        const message: FromWebviewMessage = raw;
        try {
            switch (message.type) {
                case 'ready':
                    this.post({
                        type: 'impact',
                        impact: this.impact,
                        connection: this.host.connection(),
                    });
                    if (this.simulating) this.post({ type: 'simulationStarted' });
                    else if (this.simulation)
                        this.post({ type: 'simulationFinished', report: this.simulation });
                    this.historyChanged();
                    break;
                case 'simulate':
                    if (this.target && !this.simulating) this.host.simulate(this.target);
                    break;
                case 'revealSource':
                    if (this.target) this.host.reveal(this.target);
                    break;
                case 'connect':
                    await vscode.commands.executeCommand(COMMANDS.connect);
                    break;
                case 'clearHistory': {
                    const ok = await vscode.window.showWarningMessage(
                        'Clear the QueryGuard history for this workspace?',
                        { modal: true },
                        'Clear'
                    );
                    if (ok === 'Clear') {
                        await this.history.clear();
                        this.historyChanged();
                    }
                    break;
                }
                case 'exportHistory':
                    await this.exportHistory(message.format);
                    break;
            }
        } catch (error) {
            Logger.error(`Webview action "${message.type}" failed`, error);
            void vscode.window.showErrorMessage(
                redact(`QueryGuard: ${error instanceof Error ? error.message : String(error)}`)
            );
        }
    }

    private async exportHistory(format: 'json' | 'csv'): Promise<void> {
        const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
        const target = await vscode.window.showSaveDialog({
            title: 'Export QueryGuard history',
            defaultUri: folder
                ? vscode.Uri.joinPath(folder, `queryguard-history.${format}`)
                : undefined,
            filters: format === 'json' ? { JSON: ['json'] } : { CSV: ['csv'] },
        });
        if (!target) return;
        const content = format === 'json' ? this.history.toJSON() : this.history.toCSV();
        await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(content));
        void vscode.window.showInformationMessage(
            `QueryGuard: history exported to ${vscode.workspace.asRelativePath(target)}.`
        );
    }

    private html(): string {
        const webview = this.panel.webview;
        const base = vscode.Uri.joinPath(this.extensionUri, 'out', 'webview');
        const script = webview.asWebviewUri(vscode.Uri.joinPath(base, 'index.js'));
        const style = webview.asWebviewUri(vscode.Uri.joinPath(base, 'index.css'));
        const nonce = randomBytes(16).toString('base64');
        const csp = [
            "default-src 'none'",
            `style-src ${webview.cspSource}`,
            `font-src ${webview.cspSource}`,
            `img-src ${webview.cspSource} data:`,
            `script-src 'nonce-${nonce}'`,
        ].join('; ');
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${style}">
<title>QueryGuard: Impact</title>
</head>
<body>
<div id="root"></div>
<script type="module" nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
    }
}
