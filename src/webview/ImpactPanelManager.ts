import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { ImpactResult } from '../core/impact/types';
import { WebviewMessage, ExtensionMessage } from './MessageBridge';
import { HistoryManager } from '../core/impact/HistoryManager';

export class ImpactPanelManager {
    public static currentPanel: ImpactPanelManager | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _lastImpact?: ImpactResult;

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, private historyManager: HistoryManager) {
        this._panel = panel;

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview, extensionUri);

        this._panel.webview.onDidReceiveMessage(
            (message: ExtensionMessage) => {
                switch (message.type) {
                    case 'WEBVIEW_READY':
                        if (this._lastImpact) {
                            this.update(this._lastImpact);
                        }
                        this.sendHistory();
                        break;
                    case 'GET_HISTORY':
                        this.sendHistory();
                        break;
                    case 'CLEAR_HISTORY':
                        this.historyManager.clear();
                        this.sendHistory();
                        break;
                    case 'SIMULATE':
                        vscode.commands.executeCommand('queryguard.simulate', message.data);
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    public static createOrShow(extensionUri: vscode.Uri, impact: ImpactResult, historyManager: HistoryManager) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (ImpactPanelManager.currentPanel) {
            ImpactPanelManager.currentPanel._lastImpact = impact;
            ImpactPanelManager.currentPanel._panel.reveal(column);
            ImpactPanelManager.currentPanel.update(impact);
            ImpactPanelManager.currentPanel.sendHistory();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'impactDetail',
            'QueryGuard: Impact Analysis',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'out')
                ]
            }
        );

        ImpactPanelManager.currentPanel = new ImpactPanelManager(panel, extensionUri, historyManager);
        ImpactPanelManager.currentPanel._lastImpact = impact;
    }

    public update(impact: ImpactResult) {
        this._lastImpact = impact;
        this._panel.webview.postMessage({ type: 'UPDATE_IMPACT', data: impact });
    }

    public updateSimulationResult(rowCount: number, error?: string) {
        this._panel.webview.postMessage({ type: 'SIMULATION_RESULT', rowCount, error });
    }

    public sendHistory() {
        const history = this.historyManager.getHistory();
        this._panel.webview.postMessage({ type: 'UPDATE_HISTORY', data: history } as WebviewMessage);
    }

    public dispose() {
        ImpactPanelManager.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) x.dispose();
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview, extensionUri: vscode.Uri) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview-ui', 'index.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview-ui', 'index.css'));

        const nonce = this.getNonce();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:; connect-src ${webview.cspSource};">
                <link rel="stylesheet" type="text/css" href="${styleUri}">
                <title>Impact Analysis</title>
            </head>
            <body>
                <div id="root"></div>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }

    private getNonce(): string {
        return crypto.randomBytes(16).toString('hex');
    }
}
