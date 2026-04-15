import React from 'react';

interface ImpactBarProps {
  affected: number;
  total: number;
  label: string;
  quality?: 'exact' | 'worst-case' | 'estimated';
}

export const ImpactBar: React.FC<ImpactBarProps> = ({ affected, total, label, quality }) => {
  const percentage = Math.min(100, Math.ceil((affected / (total || 1)) * 100));
  const isWorstCase = quality === 'worst-case';
  
  return (
    <div style={{ marginBottom: '12px' }}>
      <div className="flex-row" style={{ justifyContent: 'space-between', marginBottom: '4px' }}>
        <span style={{ fontSize: '0.85rem' }}>{label}</span>
        <span style={{ fontSize: '0.85rem', opacity: 0.8 }}>
          {isWorstCase ? 'Up to ' : ''}{affected.toLocaleString()} / {total.toLocaleString()} ({percentage}%)
        </span>
      </div>
      <div style={{ 
        height: '8px', 
        backgroundColor: 'var(--vscode-progressBar-background)', 
        borderRadius: '4px',
        overflow: 'hidden' 
      }}>
        <div style={{ 
          height: '100%', 
          width: `${percentage}%`, 
          backgroundColor: percentage > 50 ? 'var(--vscode-errorForeground)' : 'var(--vscode-editorWarning-foreground)',
          transition: 'width 0.3s ease'
        }} />
      </div>
    </div>
  );
};
