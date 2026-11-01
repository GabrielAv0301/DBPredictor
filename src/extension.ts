import * as path from 'path';
import * as vscode from 'vscode';
import { SUPPORTED_LANGUAGES } from './core/detectors';
import { ConnectionManager } from './db/ConnectionManager';
import { QueryGuard } from './QueryGuard';
import { AnalysisService } from './services/AnalysisService';
import { HistoryStore } from './services/HistoryStore';
import { ProfileStore } from './services/ProfileStore';
import { ProjectIndexService } from './services/ProjectIndexService';
import { SchemaService } from './services/SchemaService';
import { SECTION, Settings } from './services/settings';
import { SimulationService } from './services/SimulationService';
import { ImpactCodeLensProvider } from './ui/CodeLensProvider';
import { DiagnosticsProvider } from './ui/DiagnosticsProvider';
import { ImpactPanel } from './ui/ImpactPanel';
import { StatusBar } from './ui/StatusBar';
import { KeyedDebouncer } from './utils/debounce';
import { Logger } from './utils/logger';

let connection: ConnectionManager | undefined;

export function activate(context: vscode.ExtensionContext): void {
    const channel = vscode.window.createOutputChannel('QueryGuard', { log: true });
    context.subscriptions.push(channel);
    Logger.setSink(channel);
    Logger.info(`QueryGuard ${context.extension.packageJSON.version as string} activated.`);

    // ---- Services ------------------------------------------------------------
    connection = new ConnectionManager(path.join(context.extensionPath, 'out', 'db.worker.js'));
    const schema = new SchemaService(connection, () => Settings.schemaRefreshSeconds);
    const project = new ProjectIndexService();
    const analysis = new AnalysisService(schema, project);
    const profiles = new ProfileStore(context.globalState, context.workspaceState, context.secrets);
    const history = new HistoryStore(context.workspaceState);
    const simulation = new SimulationService(connection, schema, project);
    const statusBar = new StatusBar();
    const codeLens = new ImpactCodeLensProvider(analysis);
    const diagnostics = new DiagnosticsProvider(analysis);
    const controller = new QueryGuard({
        extensionUri: context.extensionUri,
        connection,
        schema,
        analysis,
        profiles,
        history,
        simulation,
        showLogs: () => channel.show(),
    });

    const selector: vscode.DocumentSelector = SUPPORTED_LANGUAGES.flatMap((language) => [
        { language, scheme: 'file' },
        { language, scheme: 'untitled' },
    ]);
    const debouncer = new KeyedDebouncer<vscode.TextDocument>(
        () => Settings.analysisDebounceMs,
        (document) => analysis.analyze(document)
    );
    const conn = connection;

    context.subscriptions.push(
        connection,
        schema,
        project,
        analysis,
        statusBar,
        codeLens,
        diagnostics,
        { dispose: () => debouncer.dispose() },
        { dispose: () => ImpactPanel.instance?.dispose() },
        ...controller.register(),
        vscode.languages.registerCodeLensProvider(selector, codeLens),
        vscode.languages.registerCodeActionsProvider(
            selector,
            diagnostics,
            DiagnosticsProvider.metadata
        ),

        // ---- Document lifecycle ---------------------------------------------
        vscode.workspace.onDidOpenTextDocument((document) => analysis.analyze(document)),
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.contentChanges.length === 0) return;
            if (event.document.languageId === 'prisma') project.indexDocument(event.document);
            else debouncer.schedule(event.document.uri.toString(), event.document);
        }),
        vscode.workspace.onDidCloseTextDocument((document) => {
            debouncer.cancel(document.uri.toString());
            analysis.forget(document.uri);
            diagnostics.clear(document);
        }),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (!event.affectsConfiguration(SECTION)) return;
            if (event.affectsConfiguration(`${SECTION}.cacheTTL`)) schema.schedule();
            analysis.reanalyzeAll();
            codeLens.refresh();
        }),

        // ---- Cross-service wiring -------------------------------------------
        conn.onDidChangeState((state) => {
            statusBar.render(state, schema.index);
            void vscode.commands.executeCommand(
                'setContext',
                'queryguard.connected',
                state.status === 'connected'
            );
            ImpactPanel.instance?.connectionChanged();
        }),
        schema.onDidChange((index) => {
            statusBar.render(conn.state, index);
            analysis.reanalyzeAll();
        }),
        project.onDidChange(() => analysis.reanalyzeAll()),
        analysis.onDidChange(() => refreshPanel(analysis))
    );

    void vscode.commands.executeCommand('setContext', 'queryguard.connected', false);
    project.start();
    vscode.workspace.textDocuments.forEach((document) => analysis.analyze(document));

    // Migrate 1.x data, then reconnect in the background (never block activation).
    void profiles
        .migrateLegacy()
        .then((migrated) => {
            if (migrated > 0) {
                Logger.info(`Migrated ${migrated} connection profile(s) to secure storage.`);
            }
        })
        .catch((error) => Logger.error('Profile migration failed', error))
        .then(() => controller.autoConnect())
        .catch((error) => Logger.error('Auto-connect failed', error));
}

/** Keeps an open panel in sync while the user edits the mutation it shows. */
function refreshPanel(analysis: AnalysisService): void {
    const panel = ImpactPanel.instance;
    if (!panel) return;
    panel.refresh((target) => analysis.find(target.uri, target.key)?.summary);
}

export async function deactivate(): Promise<void> {
    if (connection) {
        await connection.disconnect().catch(() => undefined);
        connection = undefined;
    }
    Logger.setSink(undefined);
}
