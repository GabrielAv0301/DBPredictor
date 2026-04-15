import * as vscode from 'vscode';
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

export async function activate(context: vscode.ExtensionContext) {
    Logger.init();
    Logger.info('QueryGuard is now active.');

    // Servicios base
    SecretsManager.init(context);
    const connManager = ConnectionManager.getInstance();

    // Inyectar ruta absoluta del worker para evitar errores de resolución de módulos
    const path = require('path');
    const workerPath = path.join(context.extensionPath, 'out', 'workers', 'db.worker.js');
    connManager.setWorkerPath(workerPath);

    const schemaCache = SchemaCache.getInstance();
    const statusBar = StatusBarProvider.init();
    const prismaDetector = new PrismaDetector();
    const supabaseDetector = new SupabaseDetector();
    const drizzleDetector = new DrizzleDetector();
    const codeLensProvider = new CodeLensProvider();
    const historyManager = new HistoryManager(context);

    // Registro de proveedores de CodeLens
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            [
                { language: 'typescript', scheme: 'file' },
                { language: 'typescriptreact', scheme: 'file' },
                { language: 'javascript', scheme: 'file' },
                { language: 'javascriptreact', scheme: 'file' }
            ],
            codeLensProvider
        )
    );

    // Escuchar cambios en la configuración para refrescar CodeLenses
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('queryguard.showCodeLens') || e.affectsConfiguration('queryguard.enabled')) {
                // Forzamos un re-análisis para actualizar los CodeLenses
                if (vscode.window.activeTextEditor) {
                    analyzeDocument(vscode.window.activeTextEditor.document);
                }
            }
        })
    );

    // Actualización de esquema y caché
    connManager.setOnSchemaUpdate((data) => {
        schemaCache.update(data);
        statusBar.update();
        if (vscode.window.activeTextEditor) {
            analyzeDocument(vscode.window.activeTextEditor.document);
        }
    });

    // Manejo de errores de conexión
    connManager.setOnError((error) => {
        statusBar.update();
        vscode.window.showErrorMessage(`QueryGuard: Database connection error. ${error}`);
    });

    // Análisis AST del documento
    const analyzeDocument = (document: vscode.TextDocument) => {
        const supportedLanguages = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'];
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
                    drizzle: drizzleMutations.length
                });
            }
            
            codeLensProvider.setMutations(document.uri.toString(), allMutations);
        } catch (error) {
            Logger.error('AST Detection failed', error);
        }
    };

    // Ajustamos el debounce segun config (por defecto 750ms)
    const config = vscode.workspace.getConfiguration('queryguard');
    const debounceMs = config.get<number>('analysisDebounce', 750);

    const debouncedAnalyze = debounce((document: vscode.TextDocument) => {
        analyzeDocument(document);
    }, debounceMs);

    // Escuchamos cambios en archivos
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            debouncedAnalyze(event.document);
        }),
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) analyzeDocument(editor.document);
        })
    );

    // Análisis inicial al arrancar
    if (vscode.window.activeTextEditor) {
        analyzeDocument(vscode.window.activeTextEditor.document);
    }

    // Auto-conexión si ya tenemos la cadena guardada
    const storedConnStr = await SecretsManager.getInstance().getConnectionString();
    if (storedConnStr) {
        Logger.info('Stored connection string found, auto-connecting...');
        await connManager.connect(storedConnStr);
        statusBar.update();
    }

    // --- Comandos de la extensión ---

    const connectCmd = vscode.commands.registerCommand('queryguard.connect', async () => {
        const connectionString = await vscode.window.showInputBox({
            prompt: 'Enter your database connection string',
            placeHolder: 'postgresql://user:password@host:port/database',
            password: true,
            ignoreFocusOut: true
        });

        if (connectionString) {
            try {
                await SecretsManager.getInstance().saveConnectionString(connectionString);
                const success = await connManager.connect(connectionString);
                if (success) {
                    vscode.window.showInformationMessage('QueryGuard: Connected to database.');
                    if (vscode.window.activeTextEditor) {
                        analyzeDocument(vscode.window.activeTextEditor.document);
                    }
                } else {
                    vscode.window.showErrorMessage('QueryGuard: Connection failed. Check logs.');
                }
                statusBar.update();
            } catch (error) {
                Logger.error('Failed to save connection string or connect', error);
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

    const showImpactPanelCmd = vscode.commands.registerCommand('queryguard.showImpactPanel', (impact) => {
        if (vscode.window.activeTextEditor) {
            historyManager.save(impact, vscode.window.activeTextEditor.document);
        }
        ImpactPanelManager.createOrShow(context.extensionUri, impact, historyManager);
    });

    const simulateCmd = vscode.commands.registerCommand('queryguard.simulate', async (impact: ImpactResult | undefined) => {
        if (!impact) {
            vscode.window.showWarningMessage(
                'QueryGuard: No mutation selected. Click a Code Lens on a database mutation to simulate it.'
            );
            return;
        }

        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Running safe simulation...',
            cancellable: false
        }, async () => {
            const result = await SimulationRunner.simulate(impact);
            if (result.error) {
                vscode.window.showErrorMessage(`Simulation failed: ${result.error}`);
            } else {
                vscode.window.showInformationMessage(
                    `Simulation complete: ${result.rowCount} rows affected. No data was modified.`
                );
                ImpactPanelManager.currentPanel?.updateSimulationResult(result.rowCount);
            }
        });
    });

    context.subscriptions.push(
        connectCmd, 
        disconnectCmd, 
        refreshSchemaCmd, 
        showImpactPanelCmd, 
        simulateCmd,
        { dispose: () => statusBar.dispose() }
    );
}

export async function deactivate(): Promise<void> {
    await ConnectionManager.getInstance().disconnect();
    Logger.info('QueryGuard is now deactivated.');
}
