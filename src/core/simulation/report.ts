import type { SimulationReport } from '../../shared/types';
import type { SimulationPlan } from './SimulationPlanner';

/** Builds a report from a plan and the counts returned by the database. */
export function buildReport(
    plan: SimulationPlan,
    counts: number[],
    durationMs: number,
    truncateWithoutCascade: boolean
): SimulationReport {
    const report: SimulationReport = {
        ok: true,
        baseRows: counts[0] ?? 0,
        exact: plan.exact,
        cascadeApproximate: plan.cascadeApproximate,
        counts: plan.queries.map((q, i) => ({
            table: q.table,
            rule: q.rule,
            depth: q.depth,
            rows: counts[i] ?? 0,
        })),
        cascadeDeletedRows: 0,
        nullifiedRows: 0,
        blockedBy: [],
        warnings: [...plan.warnings],
        durationMs,
        finishedAt: Date.now(),
    };
    const cascaded = new Set(
        report.counts.filter((c) => c.rule === 'CASCADE' && c.rows > 0).map((c) => c.table)
    );
    for (const c of report.counts.slice(1)) {
        if (c.rule === 'CASCADE') report.cascadeDeletedRows += c.rows;
        else if (c.rule === 'SET NULL' || c.rule === 'SET DEFAULT') report.nullifiedRows += c.rows;
        else if (truncateWithoutCascade) report.blockedBy.push({ table: c.table, rows: c.rows });
        else if (c.rows > 0 && cascaded.has(c.table)) {
            // The referencing rows may themselves be removed by another CASCADE path.
            report.warnings.push(
                `${c.rows} row(s) in ${c.table} reference the deleted rows (RESTRICT / NO ACTION) but ${c.table} is also cleaned up by a cascade: the statement may or may not fail.`
            );
        } else if (c.rows > 0) report.blockedBy.push({ table: c.table, rows: c.rows });
    }
    // The UI already states that the statement would fail; only add the remedy for TRUNCATE.
    if (truncateWithoutCascade && report.blockedBy.length > 0) {
        report.warnings.unshift(
            'TRUNCATE would fail: other tables reference this table (add CASCADE or truncate them too).'
        );
    }
    return report;
}
