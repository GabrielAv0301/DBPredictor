import React from 'react';
import { Treemap, ResponsiveContainer, Tooltip } from 'recharts';
import { CascadeResult } from '../types/shared';

interface CascadeTreeMapProps {
  results: CascadeResult[];
}

interface TreemapNode {
  name: string;
  size: number;
}

export const CascadeTreeMap: React.FC<CascadeTreeMapProps> = ({ results }) => {
  // Flatten recursive results for Treemap
  const flatten = (items: CascadeResult[]): TreemapNode[] => {
    return items.flatMap((item): TreemapNode[] => [
      { name: item.table, size: item.rowsEstimated },
      ...flatten(item.children)
    ]);
  };

  const data = flatten(results);

  if (data.length === 0) return null;

  return (
    <div style={{ width: '100%', height: 250, marginTop: '16px' }}>
      <ResponsiveContainer>
        <Treemap
          data={data}
          dataKey="size"
          aspectRatio={4 / 3}
          stroke="#fff"
          fill="var(--vscode-charts-blue)"
        >
          <Tooltip 
            contentStyle={{ 
              backgroundColor: 'var(--vscode-notifications-background)', 
              border: '1px solid var(--vscode-widget-border)',
              borderRadius: '4px',
              color: 'var(--vscode-notifications-foreground)' 
            }}
            itemStyle={{
              color: 'var(--vscode-notifications-foreground)'
            }}
            formatter={(value: number) => [`${value} rows`, 'Estimated Impact']}
          />
        </Treemap>
      </ResponsiveContainer>
    </div>
  );
};
