import * as vscode from 'vscode';
import { mayContainDrizzleTables, parseDrizzleTables } from '../core/project/drizzleSchema';
import { parsePrismaSchema } from '../core/project/prismaSchema';
import { ProjectModel } from '../core/project/ProjectModel';
import { Emitter } from '../utils/events';
import { Logger } from '../utils/logger';

const EXCLUDE = '**/{node_modules,.git,dist,build,out,.next,.nuxt,.turbo,.vercel,coverage}/**';
const CODE_GLOB = '**/*.{ts,mts,cts,js,mjs,cjs}';
const PRISMA_GLOB = '**/*.prisma';
const MAX_CODE_FILES = 5000;
const MAX_FILE_BYTES = 1_000_000;
const CONCURRENCY = 16;

/**
 * Indexes the workspace's ORM definitions (Prisma schema files and Drizzle
 * `pgTable` declarations) so that code names can be mapped to real tables
 * and columns. Runs in the background and updates incrementally.
 */
export class ProjectIndexService implements vscode.Disposable {
    public readonly model = new ProjectModel();
    private readonly emitter = new Emitter<void>();
    public readonly onDidChange = this.emitter.event;
    private readonly disposables: vscode.Disposable[] = [];
    private changeTimer: NodeJS.Timeout | undefined;

    public start(): void {
        const prismaWatcher = vscode.workspace.createFileSystemWatcher(PRISMA_GLOB);
        const codeWatcher = vscode.workspace.createFileSystemWatcher(CODE_GLOB);
        this.disposables.push(
            prismaWatcher,
            codeWatcher,
            prismaWatcher.onDidCreate((uri) => this.indexPrisma(uri)),
            prismaWatcher.onDidChange((uri) => this.indexPrisma(uri)),
            prismaWatcher.onDidDelete((uri) => this.remove(uri)),
            codeWatcher.onDidCreate((uri) => this.indexCode(uri)),
            codeWatcher.onDidChange((uri) => this.indexCode(uri)),
            codeWatcher.onDidDelete((uri) => this.remove(uri))
        );
        void this.scan();
    }

    public async scan(): Promise<void> {
        if (!vscode.workspace.workspaceFolders?.length) return;
        const started = Date.now();
        try {
            const prismaFiles = await vscode.workspace.findFiles(PRISMA_GLOB, EXCLUDE, 200);
            await Promise.all(prismaFiles.map((uri) => this.indexPrisma(uri, false)));

            const codeFiles = await vscode.workspace.findFiles(CODE_GLOB, EXCLUDE, MAX_CODE_FILES);
            for (let i = 0; i < codeFiles.length; i += CONCURRENCY) {
                await Promise.all(
                    codeFiles.slice(i, i + CONCURRENCY).map((uri) => this.indexCode(uri, false))
                );
            }
            const { prismaModels, drizzleTables } = this.model.stats;
            Logger.info(
                `Project indexed in ${Date.now() - started} ms: ${prismaModels} Prisma models, ${drizzleTables} Drizzle tables.`
            );
        } catch (error) {
            Logger.warn('Project indexing failed', error);
        }
        this.emitter.fire();
    }

    /** Index an open document directly (keeps the index fresh while typing). */
    public indexDocument(document: vscode.TextDocument): void {
        if (document.uri.scheme !== 'file') return;
        const text = document.getText();
        if (document.languageId === 'prisma' || document.fileName.endsWith('.prisma')) {
            this.model.setPrismaFile(document.uri.toString(), parsePrismaSchema(text));
        } else if (mayContainDrizzleTables(text)) {
            this.model.setDrizzleFile(
                document.uri.toString(),
                parseDrizzleTables(text, document.fileName)
            );
        }
    }

    public dispose(): void {
        if (this.changeTimer) clearTimeout(this.changeTimer);
        this.disposables.forEach((d) => d.dispose());
        this.emitter.dispose();
    }

    private async read(uri: vscode.Uri): Promise<string | undefined> {
        try {
            const stat = await vscode.workspace.fs.stat(uri);
            if (stat.size > MAX_FILE_BYTES) return undefined;
            return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
        } catch {
            return undefined;
        }
    }

    private async indexPrisma(uri: vscode.Uri, notify = true): Promise<void> {
        const text = await this.read(uri);
        if (text === undefined) return;
        this.model.setPrismaFile(uri.toString(), parsePrismaSchema(text));
        if (notify) this.notifySoon();
    }

    private async indexCode(uri: vscode.Uri, notify = true): Promise<void> {
        if (/[\\/]node_modules[\\/]/.test(uri.fsPath) || uri.fsPath.endsWith('.d.ts')) return;
        const text = await this.read(uri);
        if (text === undefined) return;
        const before = this.model.hasFile(uri.toString());
        if (!mayContainDrizzleTables(text)) {
            if (before) {
                this.model.removeFile(uri.toString());
                if (notify) this.notifySoon();
            }
            return;
        }
        this.model.setDrizzleFile(uri.toString(), parseDrizzleTables(text, uri.fsPath));
        if (notify) this.notifySoon();
    }

    private remove(uri: vscode.Uri): void {
        if (this.model.hasFile(uri.toString())) {
            this.model.removeFile(uri.toString());
            this.notifySoon();
        }
    }

    /** Coalesces bursts of file events (git checkout, formatters…). */
    private notifySoon(): void {
        if (this.changeTimer) clearTimeout(this.changeTimer);
        this.changeTimer = setTimeout(() => this.emitter.fire(), 300);
    }
}
