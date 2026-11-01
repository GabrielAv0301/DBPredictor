import * as vscode from 'vscode';
import type { ImpactAnalysis } from './core/impact/ImpactEngine';
import type { ConnectionManager } from './db/ConnectionManager';
import { describeConnection, isPostgresUrl, parseConnectionString, resolveSsl } from './db/ssl';
import type { AnalysisService } from './services/AnalysisService';
import type { HistoryStore } from './services/HistoryStore';
import type { ConnectionProfile, ProfileStore } from './services/ProfileStore';
import type { SchemaService } from './services/SchemaService';
import { Settings } from './services/settings';
import { failure, isPrepared, type SimulationService } from './services/SimulationService';
import type { SimulationReport } from './shared/types';
import { Logger, redact } from './utils/logger';
import { COMMANDS, formatCount, isMutationTarget, type MutationTarget } from './ui/format';
import { ImpactPanel, type PanelHost } from './ui/ImpactPanel';

export interface Services {
    extensionUri: vscode.Uri;
    connection: ConnectionManager;
    schema: SchemaService;
    analysis: AnalysisService;
    profiles: ProfileStore;
    history: HistoryStore;
    simulation: SimulationService;
    showLogs(): void;
}

interface ProfileItem extends vscode.QuickPickItem {
    profile?: ConnectionProfile;
    action?: 'new';
}

const DELETE_BUTTON: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('trash'),
    tooltip: 'Delete profile',
};

/** Command handlers and user flows. */
export class QueryGuard implements PanelHost {
    constructor(private readonly s: Services) {}

    public register(): vscode.Disposable[] {
        const reg = (id: string, fn: (...args: unknown[]) => unknown) =>
            vscode.commands.registerCommand(id, async (...args: unknown[]) => {
                try {
                    await fn(...args);
                } catch (error) {
                    Logger.error(`Command ${id} failed`, error);
                    void vscode.window.showErrorMessage(
                        redact(
                            `QueryGuard: ${error instanceof Error ? error.message : String(error)}`
                        )
                    );
                }
            });
        return [
            reg(COMMANDS.connect, () => this.pickConnection()),
            reg(COMMANDS.disconnect, () => this.disconnect()),
            reg(COMMANDS.refreshSchema, () => this.refreshSchema()),
            reg(COMMANDS.showImpactPanel, (arg) => this.showImpact(arg)),
            reg(COMMANDS.simulate, (arg) => this.simulateCommand(arg)),
            reg(COMMANDS.showMenu, () => this.showMenu()),
            reg(COMMANDS.showLogs, () => this.s.showLogs()),
        ];
    }

    // ---- PanelHost ---------------------------------------------------------

    public connection() {
        const state = this.s.connection.state;
        return {
            connected: state.status === 'connected',
            profileName: state.status === 'disconnected' ? undefined : state.profileName,
        };
    }

    public simulate(target: MutationTarget): void {
        void this.simulateCommand(target);
    }

    public reveal(target: MutationTarget): void {
        const analysis = this.s.analysis.find(target.uri, target.key);
        if (!analysis) return;
        const { start, end } = analysis.mutation.range;
        void vscode.window.showTextDocument(vscode.Uri.parse(target.uri), {
            selection: new vscode.Range(start.line, start.character, end.line, end.character),
            viewColumn: vscode.ViewColumn.One,
        });
    }

    // ---- Connection --------------------------------------------------------

    public async autoConnect(): Promise<void> {
        const id = this.s.profiles.activeId;
        if (!Settings.autoConnect || !id) return;
        const profile = this.s.profiles.get(id);
        if (!profile) {
            await this.s.profiles.setActive(undefined);
            return;
        }
        try {
            await this.connectProfile(profile, { silent: true });
        } catch (error) {
            const message = redact(error instanceof Error ? error.message : String(error));
            const choice = await vscode.window.showWarningMessage(
                `QueryGuard: could not reconnect to "${profile.name}". ${message}`,
                'Retry',
                'Show Logs'
            );
            if (choice === 'Retry') await this.connectProfile(profile).catch(() => undefined);
            if (choice === 'Show Logs') this.s.showLogs();
        }
    }

    private async pickConnection(): Promise<void> {
        const quickPick = vscode.window.createQuickPick<ProfileItem>();
        quickPick.title = 'QueryGuard: Connect to a PostgreSQL database';
        quickPick.placeholder = 'Choose a saved connection or create a new one';
        const activeId = this.s.profiles.activeId;

        const build = () => {
            const items: ProfileItem[] = [
                { label: '$(add) New connection…', action: 'new', alwaysShow: true },
            ];
            const profiles = this.s.profiles.list();
            if (profiles.length > 0) {
                items.push({
                    label: 'Saved connections',
                    kind: vscode.QuickPickItemKind.Separator,
                });
                for (const profile of profiles) {
                    items.push({
                        label: `$(database) ${profile.name}`,
                        description: profile.target,
                        detail:
                            profile.id === activeId ? '$(check) Used by this workspace' : undefined,
                        profile,
                        buttons: [DELETE_BUTTON],
                    });
                }
            }
            quickPick.items = items;
        };
        build();

        const selected = await new Promise<ProfileItem | undefined>((resolve) => {
            quickPick.onDidAccept(() => resolve(quickPick.selectedItems[0]));
            quickPick.onDidHide(() => resolve(undefined));
            quickPick.onDidTriggerItemButton(async (e) => {
                if (!e.item.profile) return;
                quickPick.busy = true;
                const confirm = await vscode.window.showWarningMessage(
                    `Delete the connection "${e.item.profile.name}"? Its stored credentials will be removed.`,
                    { modal: true },
                    'Delete'
                );
                if (confirm === 'Delete') {
                    if (this.connectedProfileId() === e.item.profile.id)
                        await this.s.connection.disconnect();
                    await this.s.profiles.delete(e.item.profile.id);
                    build();
                }
                quickPick.busy = false;
                quickPick.show();
            });
            quickPick.show();
        });
        quickPick.dispose();

        if (!selected) return;
        if (selected.action === 'new') {
            await this.createConnection();
        } else if (selected.profile) {
            await this.connectProfile(selected.profile);
        }
    }

    private async createConnection(): Promise<void> {
        const connectionString = await vscode.window.showInputBox({
            title: 'QueryGuard: New connection (1/2)',
            prompt: 'PostgreSQL connection URL. It is stored in the OS keychain (VS Code SecretStorage).',
            placeHolder: 'postgresql://user:password@host:5432/database',
            password: true,
            ignoreFocusOut: true,
            validateInput: (value) => {
                if (!value.trim()) return 'Enter a connection URL.';
                if (!isPostgresUrl(value))
                    return 'Use the URL format: postgresql://user:password@host:port/database';
                if (!parseConnectionString(value))
                    return 'This URL could not be parsed. Percent-encode special characters in the password.';
                return undefined;
            },
        });
        if (!connectionString) return;

        const suggested = parseConnectionString(connectionString)?.host ?? 'Database';
        const name = await vscode.window.showInputBox({
            title: 'QueryGuard: New connection (2/2)',
            prompt: `Name for ${describeConnection(connectionString)}`,
            value: suggested,
            placeHolder: 'e.g. Local, Staging, Production',
            ignoreFocusOut: true,
            validateInput: (value) => {
                const trimmed = value.trim();
                if (!trimmed) return 'Enter a name.';
                if (
                    this.s.profiles
                        .list()
                        .some((p) => p.name.toLowerCase() === trimmed.toLowerCase())
                ) {
                    return 'A connection with this name already exists.';
                }
                return undefined;
            },
        });
        if (!name) return;

        const profile = await this.s.profiles.create(name, connectionString.trim());
        await this.connectProfile(profile);
    }

    private async connectProfile(
        profile: ConnectionProfile,
        options: { silent?: boolean } = {}
    ): Promise<void> {
        const connectionString = await this.s.profiles.getConnectionString(profile.id);
        if (!connectionString) {
            // Don't delete the profile: the keychain may just be locked or unavailable.
            throw new Error(
                `The credentials of "${profile.name}" could not be read from the OS keychain. Unlock the keychain and retry, or delete and re-create the connection.`
            );
        }

        let caPem: string | undefined;
        const caPath = Settings.sslRootCertPath;
        if (caPath) {
            try {
                caPem = new TextDecoder().decode(
                    await vscode.workspace.fs.readFile(vscode.Uri.file(caPath))
                );
            } catch {
                throw new Error(
                    `Could not read the CA certificate at "${caPath}" (queryguard.sslRootCertPath).`
                );
            }
        }
        const ssl = resolveSsl(connectionString, Settings.sslMode, caPem);
        Logger.info(`Connecting to ${profile.target} (TLS: ${ssl.effectiveMode})`);

        const run = async () => {
            const result = await this.s.connection.connect(
                { id: profile.id, name: profile.name },
                {
                    connectionString: ssl.connectionString,
                    ssl: ssl.ssl,
                    applicationName: 'QueryGuard (VS Code)',
                }
            );
            await this.s.profiles.setActive(profile.id);
            const index = await this.s.schema.refresh();
            Logger.info(`Connected to ${profile.target} (PostgreSQL ${result.serverVersion}).`);
            return index;
        };

        if (options.silent) {
            await run();
            return;
        }
        const index = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `QueryGuard: connecting to ${profile.name}…`,
            },
            run
        );
        void vscode.window.showInformationMessage(
            `QueryGuard: connected to "${profile.name}" (${index?.tableCount ?? 0} tables).`
        );
    }

    private connectedProfileId(): string | undefined {
        const state = this.s.connection.state;
        return state.status === 'disconnected' ? undefined : state.profileId;
    }

    private async disconnect(): Promise<void> {
        await this.s.connection.disconnect();
        await this.s.profiles.setActive(undefined);
        void vscode.window.showInformationMessage('QueryGuard: disconnected.');
    }

    private async refreshSchema(): Promise<void> {
        if (!this.s.connection.isConnected) {
            await this.offerConnect('Not connected to a database.');
            return;
        }
        const index = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: 'QueryGuard: refreshing schema' },
            () => this.s.schema.refresh()
        );
        void vscode.window.setStatusBarMessage(
            `QueryGuard: schema refreshed (${index?.tableCount ?? 0} tables)`,
            4000
        );
    }

    private async offerConnect(reason: string): Promise<void> {
        const choice = await vscode.window.showWarningMessage(`QueryGuard: ${reason}`, 'Connect…');
        if (choice) await this.pickConnection();
    }

    // ---- Analysis ----------------------------------------------------------

    /** Finds the mutation from a CodeLens argument or from the cursor position. */
    private resolveTarget(
        arg: unknown
    ): { target: MutationTarget; analysis: ImpactAnalysis } | undefined {
        if (isMutationTarget(arg)) {
            const analysis = this.s.analysis.find(arg.uri, arg.key);
            return analysis ? { target: arg, analysis } : undefined;
        }
        const editor = vscode.window.activeTextEditor;
        if (!editor) return undefined;
        const analysis = this.s.analysis.findAt(editor.document, editor.selection.active);
        return analysis
            ? {
                  target: { uri: editor.document.uri.toString(), key: analysis.summary.key },
                  analysis,
              }
            : undefined;
    }

    private async showImpact(arg: unknown): Promise<void> {
        const resolved = this.resolveTarget(arg);
        if (!resolved) {
            void vscode.window.showInformationMessage(
                'QueryGuard: place the cursor on a Prisma, Supabase, Drizzle or raw SQL mutation (delete / update).'
            );
            return;
        }
        await this.s.history.record(resolved.analysis.summary);
        ImpactPanel.show(
            this.s.extensionUri,
            this.s.history,
            this,
            resolved.target,
            resolved.analysis.summary
        );
    }

    private async simulateCommand(arg: unknown): Promise<void> {
        const resolved = this.resolveTarget(arg);
        if (!resolved) {
            void vscode.window.showInformationMessage(
                'QueryGuard: place the cursor on a database mutation to count the rows it affects.'
            );
            return;
        }
        if (!this.s.connection.isConnected) {
            await this.offerConnect('connect a database to count affected rows.');
            return;
        }

        // Prompts (runtime values) happen first, outside any progress UI.
        const prepared = await this.s.simulation.prepare(resolved.analysis);
        if (!prepared) return; // cancelled by the user

        const panel = ImpactPanel.instance?.isShowing(resolved.target)
            ? ImpactPanel.instance
            : undefined;
        let report: SimulationReport;
        if (isPrepared(prepared)) {
            panel?.simulationStarted();
            try {
                report = await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'QueryGuard: counting affected rows (read-only)…',
                    },
                    () => this.s.simulation.execute(prepared)
                );
            } catch (error) {
                report = failure(error instanceof Error ? error.message : String(error));
            }
        } else {
            report = prepared;
        }

        // The panel may have been closed or switched to another mutation meanwhile.
        if (panel && ImpactPanel.instance === panel && panel.isShowing(resolved.target)) {
            panel.simulationFinished(report);
        }
        await this.s.history.record(resolved.analysis.summary, report);
        ImpactPanel.instance?.historyChanged();

        if (!report.ok) {
            void vscode.window.showErrorMessage(
                redact(`QueryGuard: simulation failed. ${report.error ?? ''}`)
            );
            return;
        }
        const summary = resolved.analysis.summary;
        const verb = summary.operation.startsWith('update') ? 'updated' : 'deleted';
        const extra = report.cascadeDeletedRows + report.nullifiedRows;
        const text =
            `QueryGuard: ${report.exact ? '' : 'at most '}${formatCount(report.baseRows)} row(s) would be ${verb}` +
            (extra > 0
                ? `, plus ${report.cascadeApproximate ? '~' : ''}${formatCount(extra)} in related tables`
                : '') +
            (report.blockedBy.length > 0
                ? ' — but the statement would FAIL (foreign keys).'
                : '.') +
            ' Nothing was modified.';
        const show = panel ? undefined : 'Show Details';
        const choice = await (report.blockedBy.length > 0
            ? vscode.window.showWarningMessage(text, ...(show ? [show] : []))
            : vscode.window.showInformationMessage(text, ...(show ? [show] : [])));
        if (choice === show && show) {
            const p = ImpactPanel.show(
                this.s.extensionUri,
                this.s.history,
                this,
                resolved.target,
                summary
            );
            p.simulationFinished(report);
        }
    }

    // ---- Menu --------------------------------------------------------------

    private async showMenu(): Promise<void> {
        const connected = this.s.connection.isConnected;
        const items: (vscode.QuickPickItem & { command: string })[] = [
            {
                label: connected ? '$(plug) Switch connection…' : '$(plug) Connect to database…',
                command: COMMANDS.connect,
            },
        ];
        if (connected) {
            items.push(
                { label: '$(refresh) Refresh schema', command: COMMANDS.refreshSchema },
                { label: '$(debug-disconnect) Disconnect', command: COMMANDS.disconnect }
            );
        }
        items.push(
            {
                label: '$(graph) Show impact of mutation at cursor',
                command: COMMANDS.showImpactPanel,
            },
            { label: '$(output) Show logs', command: COMMANDS.showLogs },
            { label: '$(gear) Settings', command: 'workbench.action.openSettings' }
        );
        const choice = await vscode.window.showQuickPick(items, { title: 'QueryGuard' });
        if (!choice) return;
        if (choice.command === 'workbench.action.openSettings') {
            await vscode.commands.executeCommand(choice.command, '@ext:queryguard.db-predictor');
        } else {
            await vscode.commands.executeCommand(choice.command);
        }
    }
}
