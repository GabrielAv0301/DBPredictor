import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

interface BlastRadiusChartProps {
  affected: number;
  total: number;
}

export const BlastRadiusChart: React.FC<BlastRadiusChartProps> = ({ affected, total }) => {
  const safe = Math.max(0, total - affected);
  const data = [
    { name: 'Affected', value: affected },
    { name: 'Remaining', value: safe },
  ];

  const COLORS = ['var(--vscode-charts-red)', 'var(--vscode-charts-lines)'];

  return (
    <div style={{ width: '100%', height: 200 }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={80}
            paddingAngle={5}
            dataKey="value"
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
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
          />
        </PieChart>
      </ResponsiveContainer>
      <div style={{ textAlign: 'center', marginTop: '-115px', paddingBottom: '80px' }}>
        <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>
          {Math.min(100, Math.ceil((affected / (total || 1)) * 100))}%
        </div>
        <div style={{ fontSize: '0.7rem', opacity: 0.7 }}>Impact</div>
      </div>
    </div>
  );
};
