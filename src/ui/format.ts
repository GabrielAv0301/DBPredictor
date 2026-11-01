import type { ImpactSummary } from '../shared/types';

export const COMMANDS = {
    connect: 'queryguard.connect',
    disconnect: 'queryguard.disconnect',
    refreshSchema: 'queryguard.refreshSchema',
    showImpactPanel: 'queryguard.showImpactPanel',
    simulate: 'queryguard.simulate',
    showMenu: 'queryguard.showMenu',
    showLogs: 'queryguard.showLogs',
} as const;

/** Argument passed by CodeLenses / code actions to identify a mutation. */
export interface MutationTarget {
    uri: string;
    key: string;
}

export function isMutationTarget(value: unknown): value is MutationTarget {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as MutationTarget).uri === 'string' &&
        typeof (value as MutationTarget).key === 'string'
    );
}

export function formatCount(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
    if (n >= 10_000) return `${Math.round(n / 1000)}k`;
    return n.toLocaleString('en-US');
}

function rowsLabel(s: ImpactSummary): string {
    if (s.totalRows === null) return '';
    switch (s.baseEstimate) {
        case 'at-most-one':
            return s.totalRows > 1
                ? `1 row + ~${formatCount(s.totalRows - 1)} cascaded`
                : '≤ 1 row';
        case 'upper-bound':
            return `up to ~${formatCount(s.totalRows)} rows`;
        default:
            return `~${formatCount(s.totalRows)} rows`;
    }
}

const ICONS: Record<ImpactSummary['riskLevel'], string> = {
    DESTRUCTIVE: '$(flame)',
    CRITICAL: '$(error)',
    WARNING: '$(warning)',
    SAFE: '$(pass)',
    UNKNOWN: '$(database)',
};

/** One-line CodeLens title. */
export function lensTitle(s: ImpactSummary): string {
    const target = s.table ?? s.tableInCode;
    if (!s.connected) {
        if (s.riskLevel === 'DESTRUCTIVE') {
            return `${ICONS.DESTRUCTIVE} QueryGuard: ${s.operation === 'truncate' ? 'TRUNCATE' : 'no filter'} — affects every row of ${target}`;
        }
        return `${ICONS.UNKNOWN} QueryGuard: connect a database to estimate impact`;
    }
    if (!s.table) {
        return `$(question) QueryGuard: table "${s.tableInCode}" not found in the database`;
    }

    const parts = [`${ICONS[s.riskLevel]} ${s.riskLevel}`];
    const rows = rowsLabel(s);
    if (rows) parts.push(rows);
    if (s.cascade.length > 0 && (s.cascadeDeletedRows > 0 || s.nullifiedRows > 0)) {
        const top = [...s.cascade]
            .filter((c) => c.rowsEstimated > 0 && c.rule !== 'RESTRICT' && c.rule !== 'NO ACTION')
            .sort((a, b) => b.rowsEstimated - a.rowsEstimated)
            .slice(0, 2)
            .map((c) => `${c.table.replace(/^public\./, '')} ~${formatCount(c.rowsEstimated)}`);
        if (top.length > 0) parts.push(`cascade → ${top.join(', ')}`);
    }
    if (s.blockers.length > 0) parts.push(`$(circle-slash) may fail (FK)`);
    return parts.join(' · ');
}
