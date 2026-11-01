import { Code2, Database, FileCode2, Info, Plug } from 'lucide-react';
import type { ConnectionInfo, ImpactSummary, SimulationReport } from '../../../src/shared/types';
import { ESTIMATE_LABEL, fmt, isStale, operationLabel, relativeTime } from '../format';
import { post } from '../vscode';
import { CascadeTree } from './CascadeTree';
import { Meter } from './Meter';
import { RiskBadge } from './RiskBadge';
import { SimulationCard } from './SimulationCard';

interface Props {
    impact: ImpactSummary | null;
    connection: ConnectionInfo;
    simulating: boolean;
    report: SimulationReport | undefined;
}

export function ImpactView({ impact, connection, simulating, report }: Props) {
    if (!impact) {
        return (
            <div className="empty">
                <Database size={40} />
                <p>
                    Click a QueryGuard CodeLens, or run “QueryGuard: Show Impact Analysis” with the
                    cursor on a mutation.
                </p>
            </div>
        );
    }

    const target = impact.table ?? impact.tableInCode;
    const counted = !simulating && report?.ok === true;
    const stale = impact.table !== null && isStale(impact.statsAnalyzedAt);

    return (
        <div className="stack">
            <header className="summary">
                <div className="summary-title">
                    <RiskBadge level={impact.riskLevel} />
                    <h1 className="mono">{target}</h1>
                </div>
                <div className="summary-meta">
                    <span>{operationLabel(impact)}</span>
                    <button
                        className="link"
                        onClick={() => post({ type: 'revealSource' })}
                        title="Go to code"
                    >
                        <FileCode2 size={13} />
                        {impact.file}:{impact.line + 1}
                    </button>
                </div>
            </header>

            {!connection.connected && (
                <div className="callout info">
                    <Plug size={16} />
                    <span>No database connected — only static analysis is available.</span>
                    <button className="button secondary" onClick={() => post({ type: 'connect' })}>
                        Connect
                    </button>
                </div>
            )}

            {impact.reasons.length > 0 && (
                <ul className="reasons">
                    {impact.reasons.map((r) => (
                        <li key={r}>
                            <Info size={14} />
                            <span>{r}</span>
                        </li>
                    ))}
                </ul>
            )}

            {impact.table && impact.tableRows !== null && (
                <section className="grid">
                    <div className="card stat-card">
                        {/* Prefer the exact count once it is known. */}
                        <Meter
                            value={counted ? report.baseRows : (impact.baseRows ?? 0)}
                            total={impact.tableRows}
                            label={
                                counted
                                    ? report.exact
                                        ? 'of table (counted)'
                                        : 'of table (counted, max)'
                                    : impact.baseEstimate === 'upper-bound'
                                      ? 'of table (max)'
                                      : 'of table'
                            }
                        />
                    </div>
                    <div className="card stats">
                        <dl>
                            <dt>Rows matched</dt>
                            <dd>
                                {impact.baseEstimate === 'upper-bound' ||
                                impact.baseEstimate === 'at-most-one'
                                    ? '≤ '
                                    : impact.baseEstimate === 'exact'
                                      ? ''
                                      : '~'}
                                {fmt(impact.baseRows)}
                                <small>{ESTIMATE_LABEL[impact.baseEstimate]}</small>
                            </dd>
                            <dt>Deleted by cascade</dt>
                            <dd>~{fmt(impact.cascadeDeletedRows)}</dd>
                            <dt>Set NULL / default</dt>
                            <dd>~{fmt(impact.nullifiedRows)}</dd>
                            <dt>Table size</dt>
                            <dd>
                                ~{fmt(impact.tableRows)}
                                <small className={stale ? 'warn-text' : undefined}>
                                    stats {relativeTime(impact.statsAnalyzedAt)}
                                </small>
                            </dd>
                        </dl>
                    </div>
                </section>
            )}

            <SimulationCard
                impact={impact}
                running={simulating}
                report={report}
                onRun={() => post({ type: 'simulate' })}
            />

            <section className="card">
                <h2>Filter</h2>
                {impact.filters.length === 0 ? (
                    <p className={impact.hasWhere ? 'muted' : 'danger-text'}>
                        {impact.hasWhere
                            ? 'Filter present but not analysable.'
                            : 'No filter — every row matches.'}
                    </p>
                ) : (
                    <ul className="chips">
                        {impact.filters.map((f) => (
                            <li key={f} className="chip mono">
                                {f}
                            </li>
                        ))}
                    </ul>
                )}
                {impact.hasWhere && !impact.filtersComplete && (
                    <p className="muted small">
                        Some conditions (OR, relations, custom SQL…) are not translated.
                    </p>
                )}
            </section>

            {(impact.cascade.length > 0 || impact.blockers.length > 0) && (
                <section className="card">
                    <h2>Foreign keys</h2>
                    <CascadeTree nodes={impact.cascade} />
                    <p className="muted small">
                        Estimated assuming related rows are evenly distributed.
                    </p>
                </section>
            )}

            <section className="card">
                <h2>
                    <Code2 size={14} /> Code
                </h2>
                <pre className="code">{impact.sourceText}</pre>
            </section>
        </div>
    );
}
