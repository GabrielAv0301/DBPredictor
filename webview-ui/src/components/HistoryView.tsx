import { Clock, Download, Trash2 } from 'lucide-react';
import type { HistoryEntry } from '../../../src/shared/types';
import { fmt, operationLabel } from '../format';
import { post } from '../vscode';
import { RiskBadge } from './RiskBadge';

export function HistoryView({ entries }: { entries: HistoryEntry[] }) {
    if (entries.length === 0) {
        return (
            <div className="empty">
                <Clock size={40} />
                <p>No history yet. Analyses you open and counts you run appear here.</p>
            </div>
        );
    }

    return (
        <div className="stack">
            <div className="toolbar">
                <span className="muted">{entries.length} entries (this workspace)</span>
                <span className="spacer" />
                <button
                    className="button secondary"
                    onClick={() => post({ type: 'exportHistory', format: 'json' })}
                >
                    <Download size={14} /> JSON
                </button>
                <button
                    className="button secondary"
                    onClick={() => post({ type: 'exportHistory', format: 'csv' })}
                >
                    <Download size={14} /> CSV
                </button>
                <button className="button danger" onClick={() => post({ type: 'clearHistory' })}>
                    <Trash2 size={14} /> Clear
                </button>
            </div>
            <ul className="history">
                {entries.map((e) => (
                    <li key={e.id} className="card history-item">
                        <div className="history-head">
                            <RiskBadge level={e.impact.riskLevel} />
                            <strong className="mono">
                                {e.impact.table ?? e.impact.tableInCode}
                            </strong>
                            <span className="spacer" />
                            <time
                                className="muted small"
                                dateTime={new Date(e.timestamp).toISOString()}
                            >
                                {new Date(e.timestamp).toLocaleString()}
                            </time>
                        </div>
                        <div className="muted small">
                            {operationLabel(e.impact)} · {e.impact.file}:{e.impact.line + 1}
                        </div>
                        <div className="small">
                            Estimate:{' '}
                            {e.impact.totalRows === null ? '—' : `~${fmt(e.impact.totalRows)} rows`}
                            {e.simulation?.ok && (
                                <>
                                    {' '}
                                    · Counted: {e.simulation.exact ? '' : '≤ '}
                                    {fmt(e.simulation.baseRows)}
                                    {e.simulation.cascadeDeletedRows + e.simulation.nullifiedRows >
                                        0 &&
                                        ` (+${fmt(e.simulation.cascadeDeletedRows + e.simulation.nullifiedRows)} related)`}
                                </>
                            )}
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    );
}
