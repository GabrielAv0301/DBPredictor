import * as vscode from 'vscode';
import { ConnectionManager } from '../core/db/ConnectionManager';

export class StatusBarProvider {
    private static instance: StatusBarProvider;
    private statusBarItem: vscode.StatusBarItem;

    private constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.statusBarItem.command = 'queryguard.refreshSchema';
        this.update();
    }

    public static init(): StatusBarProvider {
        if (!this.instance) {
            this.instance = new StatusBarProvider();
        }
        return this.instance;
    }

    public static getInstance(): StatusBarProvider {
        if (!this.instance) {
            throw new Error('StatusBarProvider not initialized. Call StatusBarProvider.init() first.');
        }
        return this.instance;
    }

    public update() {
        const isConnected = ConnectionManager.getInstance().getIsConnected();
        if (isConnected) {
            this.statusBarItem.text = '$(database) QueryGuard: Connected';
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.remoteBackground');
            this.statusBarItem.tooltip = 'Click to refresh schema';
        } else {
            this.statusBarItem.text = '$(circle-slash) QueryGuard: Disconnected';
            this.statusBarItem.backgroundColor = undefined;
            this.statusBarItem.tooltip = 'Database not connected';
        }
        this.statusBarItem.show();
    }

    public dispose() {
        this.statusBarItem.dispose();
    }
}
