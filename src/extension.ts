import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from './utils/logger';
import { SecretsManager } from './config/SecretsManager';
import { ConnectionManager } from './core/db/ConnectionManager';
import { SchemaCache } from './core/db/SchemaCache';
import { StatusBarProvider } from './providers/StatusBarProvider';
import { PrismaDetector } from './core/detectors/PrismaDetector';
import { SupabaseDetector } from './core/detectors/SupabaseDetector';
import { DrizzleDetector } from './core/detectors/DrizzleDetector';
import { debounce } from './utils/debounce';
import { CodeLensProvider } from './providers/CodeLensProvider';
import { HistoryManager } from './core/impact/HistoryManager';
import { ImpactPanelManager } from './webview/ImpactPanelManager';
import { SimulationRunner } from './core/db/SimulationRunner';
import { ImpactResult } from './core/impact/types';
import { ConnectionProfileManager } from './config/ConnectionProfile';
import { DiagnosticProvider } from './providers/DiagnosticProvider';

export async function activate(context: vscode.ExtensionContext) {
    Logger.init();
    Logger.info('QueryGuard is now active.');

    // Base services
    SecretsManager.init(context);
    const connManager = ConnectionManager.getInstance();

    // Inject absolute worker path to avoid module resolution errors
    const workerPath = path.join(context.extensionPath, 'out', 'workers', 'db.worker.js');
    connManager.setWorkerPath(workerPath);

    const schemaCache = SchemaCache.getInstance();
    const statusBar = StatusBarProvider.init();
    const prismaDetector = new PrismaDetector();
    const supabaseDetector = new SupabaseDetector();
    const drizzleDetector = new DrizzleDetector();
    const codeLensProvider = new CodeLensProvider();
    const historyManager = new HistoryManager(context);
    const diagnosticProvider = new DiagnosticProvider();

    // Register CodeLens providers
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            [
                { language: 'typescript', scheme: 'file' },
                { language: 'typescriptreact', scheme: 'file' },
                { language: 'javascript', scheme: 'file' },
                { language: 'javascriptreact', scheme: 'file' },
            ],
            codeLensProvider
        ),
        vscode.languages.registerCodeActionsProvider(
            [
                { language: 'typescript', scheme: 'file' },
                { language: 'typescriptreact', scheme: 'file' },
                { language: 'javascript', scheme: 'file' },
                { language: 'javascriptreact', scheme: 'file' },
            ],
            diagnosticProvider
        )
    );

    // Listen for configuration changes to refresh CodeLenses and Diagnostics
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (
                e.affectsConfiguration('queryguard.showCodeLens') ||
                e.affectsConfiguration('queryguard.enabled')
            ) {
                diagnosticProvider.clear();
                // Force re-analysis to update CodeLenses and Diagnostics
                if (vscode.window.activeTextEditor) {
                    analyzeDocument(vscode.window.activeTextEditor.document);
                }
            }
        })
    );

    // Schema and cache updates
    connManager.setOnSchemaUpdate((data) => {
        schemaCache.update(data);
        statusBar.update();
        if (vscode.window.activeTextEditor) {
            analyzeDocument(vscode.window.activeTextEditor.document);
        }
    });

    // Connection error handling
    connManager.setOnError((error) => {
        statusBar.update();
        vscode.window.showErrorMessage(`QueryGuard: Database connection error. ${error}`);
    });

    connManager.setOnConnectionStatusChange((isConnected) => {
        ImpactPanelManager.currentPanel?.sendConnectionStatus(isConnected);
    });

    // AST Document Analysis
    const analyzeDocument = (document: vscode.TextDocument) => {
        const supportedLanguages = [
            'typescript',
            'typescriptreact',
            'javascript',
            'javascriptreact',
        ];
        if (!supportedLanguages.includes(document.languageId)) return;

        const config = vscode.workspace.getConfiguration('queryguard');
        if (!config.get<boolean>('enabled', true)) return;

        try {
            const prismaMutations = prismaDetector.detect(document);
            const supabaseMutations = supabaseDetector.detect(document);
            const drizzleMutations = drizzleDetector.detect(document);

            const allMutations = [...prismaMutations, ...supabaseMutations, ...drizzleMutations];

            if (allMutations.length > 0) {
                Logger.info(`Detected ${allMutations.length} mutations`, {
                    prisma: prismaMutations.length,
                    supabase: supabaseMutations.length,
                    drizzle: drizzleMutations.length,
                });
            }

            codeLensProvider.setMutations(document.uri.toString(), allMutations);
            diagnosticProvider.update(document);
        } catch (error) {
            Logger.error('AST Detection failed', error);
        }
    };

    // Adjust debounce based on config (default 750ms)
    const config = vscode.workspace.getConfiguration('queryguard');
    const debounceMs = config.get<number>('analysisDebounce', 750);

    const debouncedAnalyze = debounce((document: vscode.TextDocument) => {
        analyzeDocument(document);
    }, debounceMs);

    // Listen for file changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event) => {
            debouncedAnalyze(event.document);
        }),
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor) analyzeDocument(editor.document);
        })
    );

    // Initial analysis on startup
    if (vscode.window.activeTextEditor) {
        analyzeDocument(vscode.window.activeTextEditor.document);
    }

    // Auto-connect if connection string is stored
    const storedConnStr = await SecretsManager.getInstance().getConnectionString();
    if (storedConnStr) {
        Logger.info('Stored connection string found, auto-connecting...');
        await connManager.connect(storedConnStr);
        statusBar.update();
    }

    // --- Extension Commands ---

    const connectCmd = vscode.commands.registerCommand('queryguard.connect', async () => {
        const profiles = await ConnectionProfileManager.list(context);
        const choices = ['New connection...'];
        profiles.forEach((p) => choices.push(`Switch to: ${p.name}`));
        if (profiles.length > 0) {
            choices.push('Delete a profile...');
        }

        const selected = await vscode.window.showQuickPick(choices, {
            placeHolder: 'QueryGuard: Connect to database',
        });

        if (!selected) return;

        if (selected === 'New connection...') {
            const connectionString = await vscode.window.showInputBox({
                prompt: 'Enter your database connection string',
                placeHolder: 'postgresql://user:password@host:port/database',
                password: true,
                ignoreFocusOut: true,
            });

            if (connectionString) {
                const name = await vscode.window.showInputBox({
                    prompt: 'Enter a name for this connection profile',
                    placeHolder: 'e.g., Production, Staging, Local',
                    ignoreFocusOut: true,
                });

                if (name) {
                    await ConnectionProfileManager.save(context, {
                        name,
                        connectionString,
                        sslMode: 'auto',
                        createdAt: Date.now(),
                    });
                }

                try {
                    await SecretsManager.getInstance().saveConnectionString(connectionString);
                    const result = await connManager.connect(connectionString);
                    if (result.success) {
                        vscode.window.showInformationMessage(
                            `QueryGuard: Connected to ${name || 'database'}.`
                        );
                        if (vscode.window.activeTextEditor) {
                            analyzeDocument(vscode.window.activeTextEditor.document);
                        }
                    } else {
                        vscode.window.showErrorMessage(
                            `QueryGuard: Connection failed. ${result.error || 'Check logs for details.'}`
                        );
                    }
                    statusBar.update();
                } catch (error) {
                    Logger.error('Failed to save connection string or connect', error);
                }
            }
        } else if (selected.startsWith('Switch to: ')) {
            const profileName = selected.replace('Switch to: ', '');
            const profile = profiles.find((p) => p.name === profileName);
            if (profile) {
                await SecretsManager.getInstance().saveConnectionString(profile.connectionString);
                const result = await connManager.connect(profile.connectionString);
                if (result.success) {
                    vscode.window.showInformationMessage(`QueryGuard: Connected to '${profileName}'.`);
                    statusBar.update();
                    if (vscode.window.activeTextEditor) {
                        analyzeDocument(vscode.window.activeTextEditor.document);
                    }
                } else {
                    vscode.window.showErrorMessage(
                        `QueryGuard: Connection to '${profileName}' failed. ${result.error}`
                    );
                }
            }
        } else if (selected === 'Delete a profile...') {
            const toDelete = await vscode.window.showQuickPick(
                profiles.map((p) => p.name),
                { placeHolder: 'Select a profile to delete' }
            );
            if (toDelete) {
                await ConnectionProfileManager.delete(context, toDelete);
                vscode.window.showInformationMessage(`QueryGuard: Profile '${toDelete}' deleted.`);
            }
        }
    });

    const disconnectCmd = vscode.commands.registerCommand('queryguard.disconnect', async () => {
        await SecretsManager.getInstance().deleteConnectionString();
        await connManager.disconnect();
        schemaCache.clear();
        statusBar.update();
        vscode.window.showInformationMessage('QueryGuard: Disconnected.');
    });

    const refreshSchemaCmd = vscode.commands.registerCommand('queryguard.refreshSchema', () => {
        if (connManager.getIsConnected()) {
            connManager.querySchema();
            vscode.window.showInformationMessage('QueryGuard: Refreshing schema...');
        } else {
            vscode.window.showErrorMessage('QueryGuard: Not connected to database.');
        }
    });

    const showImpactPanelCmd = vscode.commands.registerCommand(
        'queryguard.showImpactPanel',
        (impact) => {
            if (vscode.window.activeTextEditor) {
                historyManager.save(impact, vscode.window.activeTextEditor.document);
            }
            ImpactPanelManager.createOrShow(context.extensionUri, impact, historyManager);
        }
    );

    const simulateCmd = vscode.commands.registerCommand(
        'queryguard.simulate',
        async (impact: ImpactResult | undefined) => {
            if (!impact) {
                vscode.window.showWarningMessage(
                    'QueryGuard: No mutation selected. Click a Code Lens on a database mutation to simulate it.'
                );
                return;
            }

            vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Running safe simulation...',
                    cancellable: false,
                },
                async () => {
                    const result = await SimulationRunner.simulate(impact);
                    if (result.error) {
                        vscode.window.showErrorMessage(`Simulation failed: ${result.error}`);
                    } else {
                        const baseMsg = `Simulation complete: ${result.rowCount} rows affected. No data was modified.`;
                        const fullMsg = result.warnCascade
                            ? `${baseMsg} (${result.warnCascade})`
                            : baseMsg;
                        vscode.window.showInformationMessage(fullMsg);
                        ImpactPanelManager.currentPanel?.updateSimulationResult(
                            result.rowCount,
                            result.warnCascade
                        );
                    }
                }
            );
        }
    );

    const showLogsCmd = vscode.commands.registerCommand('queryguard.showLogs', () => {
        Logger.show();
    });

    context.subscriptions.push(
        connectCmd,
        disconnectCmd,
        refreshSchemaCmd,
        showImpactPanelCmd,
        simulateCmd,
        showLogsCmd,
        { dispose: () => statusBar.dispose() }
    );
}

export async function deactivate(): Promise<void> {
    await ConnectionManager.getInstance().disconnect();
    Logger.info('QueryGuard is now deactivated.');
}
