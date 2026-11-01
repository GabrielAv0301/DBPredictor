import * as vscode from 'vscode';
import type { ConnectionState } from '../db/ConnectionManager';
import type { SchemaIndex } from '../core/schema/types';
import { COMMANDS } from './format';

const PRODUCTION_HINT = /\b(prod|production|live|prd)\b/i;

export class StatusBar implements vscode.Disposable {
    private readonly item = vscode.window.createStatusBarItem(
        'queryguard.status',
        vscode.StatusBarAlignment.Left,
        50
    );

    constructor() {
        this.item.name = 'QueryGuard';
        this.item.command = COMMANDS.showMenu;
        this.render({ status: 'disconnected' }, null);
        this.item.show();
    }

    public render(state: ConnectionState, index: SchemaIndex | null): void {
        const tooltip = new vscode.MarkdownString(undefined, true);
        tooltip.isTrusted = false;
        this.item.backgroundColor = undefined;

        switch (state.status) {
            case 'disconnected':
                this.item.text = '$(database) QueryGuard';
                tooltip.appendMarkdown(
                    '**QueryGuard** — not connected\n\nClick to connect a PostgreSQL database.'
                );
                break;
            case 'connecting':
                this.item.text = `$(sync~spin) QueryGuard: ${state.profileName}`;
                tooltip.appendMarkdown(`Connecting to **${escape(state.profileName)}**…`);
                break;
            case 'connected': {
                const tables = index ? `${index.tableCount} tables` : 'loading schema…';
                this.item.text = `$(database) QueryGuard: ${state.profileName}`;
                tooltip.appendMarkdown(
                    `**QueryGuard** — connected to **${escape(state.profileName)}**\n\n` +
                        `PostgreSQL ${Math.floor(state.serverVersion / 10000)} · ${tables}`
                );
                if (index) {
                    tooltip.appendMarkdown(
                        `\n\nSchema loaded ${new Date(index.snapshot.fetchedAt).toLocaleTimeString()}`
                    );
                }
                if (PRODUCTION_HINT.test(state.profileName)) {
                    this.item.backgroundColor = new vscode.ThemeColor(
                        'statusBarItem.warningBackground'
                    );
                    tooltip.appendMarkdown('\n\n$(warning) This looks like a production database.');
                }
                break;
            }
        }
        tooltip.appendMarkdown('\n\n_Click for actions_');
        this.item.tooltip = tooltip;
    }

    public dispose(): void {
        this.item.dispose();
    }
}

function escape(text: string): string {
    return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');
}
