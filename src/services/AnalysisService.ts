import * as vscode from 'vscode';
import { analyzeSource, SUPPORTED_LANGUAGES, type SourceLanguage } from '../core/detectors';
import { analyzeImpact, type ImpactAnalysis } from '../core/impact/ImpactEngine';
import { Emitter } from '../utils/events';
import { Logger } from '../utils/logger';
import type { ProjectIndexService } from './ProjectIndexService';
import type { SchemaService } from './SchemaService';
import { Settings } from './settings';

const MAX_DOCUMENT_LENGTH = 1_500_000;

export interface DocumentAnalysis {
    uri: string;
    version: number;
    impacts: ImpactAnalysis[];
}

/**
 * Single source of truth for analysis results. Parses each document once per
 * version and recomputes impacts when the schema or project index changes.
 * CodeLens, diagnostics and commands all read from here.
 */
export class AnalysisService implements vscode.Disposable {
    private readonly results = new Map<string, DocumentAnalysis>();
    private readonly emitter = new Emitter<string | undefined>();
    /** Fires with a document URI, or `undefined` when everything changed. */
    public readonly onDidChange = this.emitter.event;

    constructor(
        private readonly schema: SchemaService,
        private readonly project: ProjectIndexService
    ) {}

    public isSupported(document: vscode.TextDocument): boolean {
        if (!SUPPORTED_LANGUAGES.includes(document.languageId as SourceLanguage)) return false;
        if (document.uri.scheme !== 'file' && document.uri.scheme !== 'untitled') return false;
        if (document.fileName.endsWith('.d.ts')) return false;
        return !Settings.exclude.some(
            (pattern) => vscode.languages.match({ pattern }, document) > 0
        );
    }

    public analyze(
        document: vscode.TextDocument,
        force = false,
        silent = false
    ): DocumentAnalysis | undefined {
        const key = document.uri.toString();
        if (!Settings.enabled || !this.isSupported(document)) {
            if (this.results.delete(key) && !silent) this.emitter.fire(key);
            return undefined;
        }
        const cached = this.results.get(key);
        if (!force && cached && cached.version === document.version) return cached;

        const text = document.getText();
        if (text.length > MAX_DOCUMENT_LENGTH) return undefined;

        try {
            this.project.indexDocument(document);
            const options = {
                ...Settings.detectorOptions,
                isKnownDrizzleTable: (name: string) => this.project.model.hasDrizzleTable(name),
            };
            const mutations = analyzeSource(
                text,
                document.fileName,
                document.languageId as SourceLanguage,
                options
            );
            const ctx = {
                index: this.schema.index,
                project: this.project.model,
                options: Settings.impactOptions,
                file: vscode.workspace.asRelativePath(document.uri, false),
            };
            const analysis: DocumentAnalysis = {
                uri: key,
                version: document.version,
                impacts: mutations.map((m) => analyzeImpact(m, ctx)),
            };
            this.results.set(key, analysis);
            if (!silent) this.emitter.fire(key);
            return analysis;
        } catch (error) {
            Logger.error(
                `Analysis failed for ${vscode.workspace.asRelativePath(document.uri)}`,
                error
            );
            return undefined;
        }
    }

    /** Re-analyses every open document (schema, settings or project index changed). */
    public reanalyzeAll(): void {
        const open = new Set<string>();
        for (const document of vscode.workspace.textDocuments) {
            open.add(document.uri.toString());
            this.analyze(document, true, true);
        }
        for (const key of [...this.results.keys()]) {
            if (!open.has(key)) this.results.delete(key);
        }
        this.emitter.fire(undefined);
    }

    public get(uri: vscode.Uri): DocumentAnalysis | undefined {
        return this.results.get(uri.toString());
    }

    public find(uri: string, key: string): ImpactAnalysis | undefined {
        return this.results.get(uri)?.impacts.find((i) => i.summary.key === key);
    }

    /** Mutation under (or nearest above) the given position. */
    public findAt(
        document: vscode.TextDocument,
        position: vscode.Position
    ): ImpactAnalysis | undefined {
        const analysis = this.analyze(document);
        if (!analysis) return undefined;
        const containing = analysis.impacts.filter((i) => {
            const { start, end } = i.mutation.range;
            const afterStart =
                position.line > start.line ||
                (position.line === start.line && position.character >= start.character);
            const beforeEnd =
                position.line < end.line ||
                (position.line === end.line && position.character <= end.character);
            return afterStart && beforeEnd;
        });
        if (containing.length > 0) {
            // Innermost match = the one that starts last.
            return containing.reduce((a, b) =>
                b.mutation.range.start.line > a.mutation.range.start.line ||
                (b.mutation.range.start.line === a.mutation.range.start.line &&
                    b.mutation.range.start.character > a.mutation.range.start.character)
                    ? b
                    : a
            );
        }
        return analysis.impacts.find((i) => i.mutation.range.start.line === position.line);
    }

    public forget(uri: vscode.Uri): void {
        if (this.results.delete(uri.toString())) this.emitter.fire(uri.toString());
    }

    public dispose(): void {
        this.results.clear();
        this.emitter.dispose();
    }
}
