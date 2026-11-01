import * as vscode from 'vscode';
import type { DetectorOptions } from '../core/detectors/types';
import { DEFAULT_DETECTOR_OPTIONS } from '../core/detectors/types';
import type { ImpactOptions } from '../core/impact/ImpactEngine';
import type { SslMode } from '../db/ssl';

export const SECTION = 'queryguard';

export type DiagnosticSeverityName = 'error' | 'warning' | 'information' | 'hint' | 'none';

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
    const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
    return Math.min(max, Math.max(min, n));
}

function stringList(value: unknown, fallback: readonly string[]): string[] {
    if (!Array.isArray(value)) return [...fallback];
    return value
        .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
        .map((v) => v.trim());
}

/** Typed, validated access to the extension settings (read fresh on every call). */
export const Settings = {
    get config(): vscode.WorkspaceConfiguration {
        return vscode.workspace.getConfiguration(SECTION);
    },
    get enabled(): boolean {
        return this.config.get<boolean>('enabled', true);
    },
    get showCodeLens(): boolean {
        return this.config.get<boolean>('showCodeLens', true);
    },
    get autoConnect(): boolean {
        return this.config.get<boolean>('autoConnect', true);
    },
    get sslMode(): SslMode {
        const mode = this.config.get<string>('sslMode', 'auto');
        return (['auto', 'disable', 'require', 'verify-ca', 'verify-full'] as const).includes(
            mode as SslMode
        )
            ? (mode as SslMode)
            : 'auto';
    },
    get sslRootCertPath(): string {
        return this.config.get<string>('sslRootCertPath', '').trim();
    },
    get analysisDebounceMs(): number {
        return clampInt(this.config.get('analysisDebounce'), 100, 10_000, 500);
    },
    get schemaRefreshSeconds(): number {
        return clampInt(this.config.get('cacheTTL'), 0, 86_400, 300);
    },
    get simulationTimeoutMs(): number {
        return clampInt(this.config.get('simulationTimeout'), 1, 120, 15) * 1000;
    },
    get diagnosticSeverity(): DiagnosticSeverityName {
        const v = this.config.get<string>('diagnosticSeverity', 'warning');
        return (['error', 'warning', 'information', 'hint', 'none'] as const).includes(
            v as DiagnosticSeverityName
        )
            ? (v as DiagnosticSeverityName)
            : 'warning';
    },
    get exclude(): string[] {
        return stringList(this.config.get('exclude'), ['**/node_modules/**']);
    },
    get impactOptions(): ImpactOptions {
        return {
            criticalRowThreshold: clampInt(
                this.config.get('criticalRowThreshold'),
                1,
                1_000_000_000,
                10_000
            ),
        };
    },
    get detectorOptions(): DetectorOptions {
        return {
            prismaClientNames: stringList(
                this.config.get('prismaClientNames'),
                DEFAULT_DETECTOR_OPTIONS.prismaClientNames
            ),
            drizzleClientNames: stringList(
                this.config.get('drizzleClientNames'),
                DEFAULT_DETECTOR_OPTIONS.drizzleClientNames
            ),
        };
    },
};
