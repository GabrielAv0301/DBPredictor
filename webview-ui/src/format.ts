import type { EstimateKind, ImpactSummary } from '../../src/shared/types';

export function fmt(n: number | null | undefined): string {
    if (n === null || n === undefined) return '—';
    return n.toLocaleString('en-US');
}

export const ESTIMATE_LABEL: Record<EstimateKind, string> = {
    exact: 'exact',
    estimated: 'estimate (planner statistics)',
    'upper-bound': 'upper bound',
    'at-most-one': 'at most one row',
    unknown: 'unknown',
};

export function operationLabel(s: Pick<ImpactSummary, 'operation' | 'orm'>): string {
    const orm = {
        prisma: 'Prisma',
        supabase: 'Supabase',
        drizzle: 'Drizzle',
        'raw-sql': 'Raw SQL',
    }[s.orm];
    return `${orm} · ${s.operation}`;
}

export function relativeTime(iso: string | null): string {
    if (!iso) return 'never';
    const ms = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(ms)) return 'unknown';
    const minutes = Math.round(ms / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours} h ago`;
    return `${Math.round(hours / 24)} days ago`;
}

export function isStale(iso: string | null): boolean {
    if (!iso) return true;
    return Date.now() - new Date(iso).getTime() > 7 * 24 * 3_600_000;
}
