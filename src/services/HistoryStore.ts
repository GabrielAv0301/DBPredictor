import { randomUUID } from 'crypto';
import type { HistoryEntry, ImpactSummary, SimulationReport } from '../shared/types';
import type { StateStore } from './ProfileStore';

const HISTORY_KEY = 'queryguard.history.v2';
export const MAX_HISTORY = 50;

/** Per-workspace history of analysed mutations and their simulations. */
export class HistoryStore {
    constructor(private readonly state: StateStore) {}

    public list(): HistoryEntry[] {
        const value = this.state.get<HistoryEntry[]>(HISTORY_KEY);
        return Array.isArray(value) ? value : [];
    }

    /** Adds an entry, replacing a previous entry for the same mutation in the same file. */
    public async record(
        impact: ImpactSummary,
        simulation?: SimulationReport
    ): Promise<HistoryEntry> {
        const entries = this.list();
        const previous = entries.find(
            (e) => e.impact.file === impact.file && e.impact.key === impact.key
        );
        const entry: HistoryEntry = {
            id: previous?.id ?? randomUUID(),
            timestamp: Date.now(),
            impact,
            simulation:
                simulation ??
                (previous && sameStatement(previous.impact, impact)
                    ? previous.simulation
                    : undefined),
        };
        const next = [entry, ...entries.filter((e) => e.id !== entry.id)].slice(0, MAX_HISTORY);
        await this.state.update(HISTORY_KEY, next);
        return entry;
    }

    public async clear(): Promise<void> {
        await this.state.update(HISTORY_KEY, []);
    }

    public toJSON(): string {
        return JSON.stringify(this.list(), null, 2);
    }

    public toCSV(): string {
        const header = [
            'timestamp',
            'file',
            'line',
            'orm',
            'operation',
            'table',
            'risk',
            'estimatedRows',
            'estimateKind',
            'simulatedRows',
            'simulatedCascadeRows',
            'filters',
        ];
        const rows = this.list().map((e) => [
            new Date(e.timestamp).toISOString(),
            e.impact.file,
            e.impact.line + 1,
            e.impact.orm,
            e.impact.operation,
            e.impact.table ?? e.impact.tableInCode,
            e.impact.riskLevel,
            e.impact.totalRows ?? '',
            e.impact.baseEstimate,
            e.simulation?.ok ? e.simulation.baseRows : '',
            e.simulation?.ok ? e.simulation.cascadeDeletedRows + e.simulation.nullifiedRows : '',
            e.impact.filters.join(' AND '),
        ]);
        return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
    }
}

function sameStatement(a: ImpactSummary, b: ImpactSummary): boolean {
    return a.sourceText === b.sourceText && a.table === b.table;
}

/**
 * RFC 4180 quoting plus protection against spreadsheet formula injection
 * (cells starting with = + - @ are prefixed with a quote).
 */
export function csvCell(value: unknown): string {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(text) && typeof value !== 'number') text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
