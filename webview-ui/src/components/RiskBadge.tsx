import React from 'react';
import { RiskLevel } from '../types/shared';

interface RiskBadgeProps {
  level: RiskLevel;
}

export const RiskBadge: React.FC<RiskBadgeProps> = ({ level }) => {
  const getStyles = () => {
    switch (level) {
      case 'DESTRUCTIVE':
        return { backgroundColor: 'var(--vscode-errorForeground)', color: 'var(--vscode-editor-background)' };
      case 'CRITICAL':
        return { backgroundColor: 'var(--vscode-editorError-foreground)', color: 'var(--vscode-editor-background)' };
      case 'WARNING':
        return { backgroundColor: 'var(--vscode-editorWarning-foreground)', color: 'var(--vscode-editor-background)' };
      case 'SAFE':
        return { backgroundColor: 'var(--vscode-debugIcon-breakpointForeground)', color: 'var(--vscode-editor-background)' };
      default:
        return {};
    }
  };

  return (
    <span className="badge" style={getStyles()}>
      {level}
    </span>
  );
};
