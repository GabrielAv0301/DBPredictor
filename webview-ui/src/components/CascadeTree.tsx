import React from 'react';
import { CascadeResult } from '../types/shared';
import { ArrowRight, ShieldAlert } from 'lucide-react';

interface CascadeTreeProps {
  results: CascadeResult[];
  level?: number;
}

export const CascadeTree: React.FC<CascadeTreeProps> = ({ results, level = 0 }) => {
  if (results.length === 0) return null;

  return (
    <div style={{ marginLeft: level > 0 ? '20px' : '0', borderLeft: level > 0 ? '1px solid var(--vscode-widget-border)' : 'none', paddingLeft: level > 0 ? '12px' : '0' }}>
      {results.map((res, i) => (
        <div key={`${res.table}-${i}`} style={{ marginBottom: '12px' }}>
          <div className="flex-row" style={{ opacity: res.rule === 'RESTRICT' ? 1 : 0.9 }}>
            <ArrowRight size={14} />
            <span style={{ fontWeight: 'bold' }}>{res.table}</span>
            <span className="subtitle" style={{ margin: 0 }}>
              ({res.rowsEstimated.toLocaleString()} rows)
            </span>
            <span style={{ 
              fontSize: '0.7rem', 
              padding: '1px 4px', 
              borderRadius: '3px', 
              backgroundColor: res.rule === 'CASCADE' ? 'var(--vscode-debugIcon-breakpointForeground)' : 'var(--vscode-editorError-foreground)',
              color: 'var(--vscode-editor-background)'
            }}>
              {res.rule}
            </span>
          </div>
          
          {res.rule === 'RESTRICT' && (
            <div className="flex-row error-text" style={{ fontSize: '0.8rem', marginTop: '4px' }}>
              <ShieldAlert size={14} />
              <span>This query WILL FAIL due to RESTRICT rule.</span>
            </div>
          )}

          <CascadeTree results={res.children} level={level + 1} />
        </div>
      ))}
    </div>
  );
};
