import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

const EXTENSION_ID = 'queryguard.db-predictor';

async function waitFor<T>(
    fn: () => T | undefined | Promise<T | undefined>,
    ms = 15_000
): Promise<T> {
    const started = Date.now();
    for (;;) {
        const value = await fn();
        if (value !== undefined) return value;
        if (Date.now() - started > ms) throw new Error('Timed out waiting for condition');
        await new Promise((r) => setTimeout(r, 100));
    }
}

describe('QueryGuard in VS Code', () => {
    let document: vscode.TextDocument;

    before(async () => {
        const folder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(folder, 'fixture workspace should be open');
        document = await vscode.workspace.openTextDocument(
            vscode.Uri.file(path.join(folder.uri.fsPath, 'src', 'cleanup.ts'))
        );
        await vscode.window.showTextDocument(document);
    });

    it('activates on a TypeScript file', async () => {
        const extension = vscode.extensions.getExtension(EXTENSION_ID);
        assert.ok(extension, 'extension should be installed');
        await waitFor(() => (extension.isActive ? true : undefined));
    });

    it('registers every contributed command', async () => {
        const commands = await vscode.commands.getCommands(true);
        for (const id of [
            'queryguard.connect',
            'queryguard.disconnect',
            'queryguard.refreshSchema',
            'queryguard.showImpactPanel',
            'queryguard.simulate',
            'queryguard.showMenu',
            'queryguard.showLogs',
        ]) {
            assert.ok(commands.includes(id), `${id} should be registered`);
        }
    });

    it('reports the unfiltered deleteMany without a database (and only that one)', async () => {
        const diagnostics = await waitFor(() => {
            const d = vscode.languages
                .getDiagnostics(document.uri)
                .filter((x) => x.source === 'QueryGuard');
            return d.length > 0 ? d : undefined;
        });
        // Only line 5 (`prisma.user.deleteMany()`): the filtered Prisma delete, the
        // ignored one and the Supabase delete filtered with .lt() must not be reported.
        assert.deepStrictEqual(
            diagnostics.map((d) => d.range.start.line),
            [5],
            diagnostics.map((d) => d.message).join('\n')
        );
        assert.strictEqual(diagnostics[0].severity, vscode.DiagnosticSeverity.Warning);
    });

    it('provides CodeLenses for every non-ignored mutation', async () => {
        const lenses = await waitFor(async () => {
            const result = await vscode.commands.executeCommand<vscode.CodeLens[]>(
                'vscode.executeCodeLensProvider',
                document.uri
            );
            return result && result.length > 0 ? result : undefined;
        });
        const titles = lenses.map((l) => l.command?.title ?? '');
        assert.ok(
            titles.some((t) => t.includes('DESTRUCTIVE') || t.includes('every row')),
            titles.join('\n')
        );
        const lensLines = new Set(lenses.map((l) => l.range.start.line));
        assert.ok(!lensLines.has(8), 'ignored mutation must not get a CodeLens');
        assert.ok(
            lensLines.has(5) && lensLines.has(6) && lensLines.has(9),
            [...lensLines].join(',')
        );
    });

    it('offers quick fixes on the diagnostic', async () => {
        const diagnostic = vscode.languages
            .getDiagnostics(document.uri)
            .find((d) => d.source === 'QueryGuard');
        assert.ok(diagnostic);
        // The workbench may cancel the request while the built-in TypeScript server
        // starts; retry until our actions come back.
        const actions = await waitFor(async () => {
            try {
                const result = await vscode.commands.executeCommand<vscode.CodeAction[]>(
                    'vscode.executeCodeActionProvider',
                    document.uri,
                    diagnostic.range,
                    vscode.CodeActionKind.QuickFix.value
                );
                return result?.some((a) => a.title.startsWith('QueryGuard')) ? result : undefined;
            } catch {
                return undefined;
            }
        }, 25_000);
        const titles = actions.map((a) => a.title);
        assert.ok(titles.includes('QueryGuard: Show impact analysis'), titles.join('\n'));
        assert.ok(titles.includes('QueryGuard: Ignore this mutation'), titles.join('\n'));
    });

    it('opens the impact panel for the mutation under the cursor', async () => {
        const editor = await vscode.window.showTextDocument(document);
        editor.selection = new vscode.Selection(5, 20, 5, 20);
        await vscode.commands.executeCommand('queryguard.showImpactPanel');
        await waitFor(() => {
            const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs);
            return tabs.some((t) => t.label === 'QueryGuard: Impact') ? true : undefined;
        });
    });

    it('clears diagnostics when disabled', async () => {
        const config = vscode.workspace.getConfiguration('queryguard');
        await config.update('enabled', false, vscode.ConfigurationTarget.Workspace);
        try {
            await waitFor(() =>
                vscode.languages.getDiagnostics(document.uri).some((d) => d.source === 'QueryGuard')
                    ? undefined
                    : true
            );
        } finally {
            await config.update('enabled', undefined, vscode.ConfigurationTarget.Workspace);
        }
    });
});
