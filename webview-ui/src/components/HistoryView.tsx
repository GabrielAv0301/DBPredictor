import React from 'react';
import { HistoryEntry } from '../types/shared';
import { RiskBadge } from './RiskBadge';
import { Clock, Trash2, FileText } from 'lucide-react';

interface HistoryViewProps {
  history: HistoryEntry[];
  onClear: () => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({ history, onClear }) => {
  if (history.length === 0) {
    return (
      <div style={{ textAlign: 'center', opacity: 0.6, padding: '40px' }}>
        <Clock size={48} style={{ marginBottom: '16px' }} />
        <p>No history yet. Analyze some mutations to populate this list.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex-row" style={{ justifyContent: 'space-between', marginBottom: '16px' }}>
        <h2 className="subtitle" style={{ fontWeight: 'bold' }}>RECENT ANALYSES</h2>
        <button 
          onClick={onClear}
          style={{ 
            background: 'none', 
            border: 'none', 
            color: 'var(--vscode-errorForeground)', 
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '0.8rem'
          }}
        >
          <Trash2 size={14} /> Clear
        </button>
      </div>

      {history.map((entry) => (
        <div key={entry.id} className="card" style={{ padding: '12px', cursor: 'default' }}>
          <div className="flex-row" style={{ justifyContent: 'space-between', marginBottom: '8px' }}>
            <div className="flex-row">
              <FileText size={14} opacity={0.7} />
              <span style={{ fontWeight: 'bold' }}>{entry.impact.table}</span>
            </div>
            <RiskBadge level={entry.impact.riskLevel} />
          </div>
          
          <div style={{ fontSize: '0.8rem', opacity: 0.8, marginBottom: '8px' }}>
            <code>{entry.impact.operation}</code> · {entry.impact.totalRowsAffected.toLocaleString()} rows
          </div>

          <div style={{ fontSize: '0.7rem', opacity: 0.5 }}>
            {new Date(entry.timestamp).toLocaleString()}
          </div>
        </div>
      ))}
    </div>
  );
};
