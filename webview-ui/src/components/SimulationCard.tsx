import { AlertTriangle, CheckCircle2, Loader2, Play, XCircle } from 'lucide-react';
import type { ImpactSummary, SimulationReport } from '../../../src/shared/types';
import { fmt } from '../format';

interface Props {
    impact: ImpactSummary;
    running: boolean;
    report: SimulationReport | undefined;
    onRun(): void;
}

export function SimulationCard({ impact, running, report, onRun }: Props) {
    const canRun = impact.connected && impact.table !== null && !running;
    const verb = impact.operation.startsWith('update') ? 'updated' : 'deleted';

    return (
        <section className="card" aria-labelledby="sim-title">
            <header className="card-header">
                <h2 id="sim-title">Exact count</h2>
                <button className="button" onClick={onRun} disabled={!canRun}>
                    {running ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
                    {running ? 'Counting…' : report ? 'Count again' : 'Count affected rows'}
                </button>
            </header>
            <p className="muted small">
                Runs <code>SELECT count(*)</code> queries in a <code>READ ONLY</code> transaction
                with a timeout. Your statement is never executed and nothing is modified.
            </p>

            {!impact.connected && <p className="muted">Connect a database to run the count.</p>}
            {impact.connected && !impact.table && (
                <p className="muted">The table could not be resolved in the connected database.</p>
            )}

            {report && !running && !report.ok && (
                <div className="callout danger" role="alert">
                    <XCircle size={16} />
                    <span>{report.error}</span>
                </div>
            )}

            {report && !running && report.ok && (
                <div className="sim-result">
                    <div
                        className={`callout ${report.blockedBy.length > 0 ? 'danger' : 'ok'}`}
                        role="status"
                    >
                        {report.blockedBy.length > 0 ? (
                            <AlertTriangle size={16} />
                        ) : (
                            <CheckCircle2 size={16} />
                        )}
                        <span>
                            <strong>
                                {report.exact ? '' : 'At most '}
                                {fmt(report.baseRows)}
                            </strong>{' '}
                            row(s) would be {verb}
                            {report.cascadeDeletedRows > 0 && (
                                <>
                                    ,{' '}
                                    <strong>
                                        {report.cascadeApproximate ? '~' : ''}
                                        {fmt(report.cascadeDeletedRows)}
                                    </strong>{' '}
                                    deleted by cascade
                                </>
                            )}
                            {report.nullifiedRows > 0 && (
                                <>
                                    , <strong>{fmt(report.nullifiedRows)}</strong> set to
                                    NULL/default
                                </>
                            )}
                            .
                            {report.blockedBy.length > 0 &&
                                ' The statement would fail because of foreign keys.'}
                        </span>
                    </div>

                    {report.counts.length > 1 && (
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Table</th>
                                    <th>Effect</th>
                                    <th className="num">Rows</th>
                                </tr>
                            </thead>
                            <tbody>
                                {report.counts.map((c, i) => (
                                    <tr key={`${c.table}:${i}`}>
                                        <td className="mono">
                                            <span
                                                className="indent"
                                                data-depth={Math.min(c.depth, 6)}
                                            />
                                            {c.table}
                                        </td>
                                        <td>{c.rule === 'BASE' ? 'statement' : c.rule}</td>
                                        <td className="num">{fmt(c.rows)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}

                    {report.warnings.length > 0 && (
                        <ul className="warnings">
                            {report.warnings.map((w) => (
                                <li key={w}>{w}</li>
                            ))}
                        </ul>
                    )}
                    <p className="muted small">
                        {report.exact
                            ? 'Exact count'
                            : 'Upper bound (some conditions could not be applied)'}
                        {report.cascadeApproximate ? ' · cascade totals approximate' : ''} ·{' '}
                        {fmt(report.durationMs)} ms ·{' '}
                        {new Date(report.finishedAt).toLocaleTimeString()}
                    </p>
                </div>
            )}
        </section>
    );
}
