import React, { useEffect, useState } from 'react';
import { useVSCodeMessage } from './hooks/useVSCodeMessage';
import { RiskBadge } from './components/RiskBadge';
import { ImpactBar } from './components/ImpactBar';
import { CascadeTree } from './components/CascadeTree';
import { BlastRadiusChart } from './components/BlastRadiusChart';
import { CascadeTreeMap } from './components/CascadeTreeMap';
import { HistoryView } from './components/HistoryView';
import { Database, AlertCircle, Info, LayoutDashboard, History, Zap } from 'lucide-react';
import { HistoryEntry, ImpactResult } from './types/shared';

type Tab = 'current' | 'history';

const App: React.FC = () => {
  const { lastMessage, postMessage } = useVSCodeMessage();
  const [activeTab, setActiveTab] = useState<Tab>('current');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [impact, setImpact] = useState<ImpactResult | null>(null);
  const [simulationResult, setSimulationResult] = useState<number | null>(null);

  useEffect(() => {
    postMessage({ type: 'WEBVIEW_READY' });
  }, [postMessage]);

  useEffect(() => {
    if (!lastMessage) return;

    switch (lastMessage.type) {
      case 'UPDATE_IMPACT':
        setImpact(lastMessage.data);
        setSimulationResult(null); // Reset simulation on new impact
        break;
      case 'UPDATE_HISTORY':
        setHistory(lastMessage.data);
        break;
      case 'SIMULATION_RESULT':
        setSimulationResult(lastMessage.rowCount);
        break;
    }
  }, [lastMessage]);

  const clearHistory = () => {
    postMessage({ type: 'CLEAR_HISTORY' });
  };

  const runSimulation = () => {
    if (impact) {
      postMessage({ type: 'SIMULATE', data: impact });
    }
  };

  return (
    <div className="app-container">
      <nav style={{ display: 'flex', gap: '20px', marginBottom: '20px', borderBottom: '1px solid var(--vscode-widget-border)' }}>
        <button 
          onClick={() => setActiveTab('current')}
          style={{ 
            padding: '8px 12px', 
            background: 'none', 
            border: 'none', 
            borderBottom: activeTab === 'current' ? '2px solid var(--vscode-button-background)' : 'none',
            color: activeTab === 'current' ? 'var(--vscode-button-background)' : 'inherit',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <Zap size={16} /> Analysis
        </button>
        <button 
          onClick={() => setActiveTab('history')}
          style={{ 
            padding: '8px 12px', 
            background: 'none', 
            border: 'none', 
            borderBottom: activeTab === 'history' ? '2px solid var(--vscode-button-background)' : 'none',
            color: activeTab === 'history' ? 'var(--vscode-button-background)' : 'inherit',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <History size={16} /> History
        </button>
      </nav>

      {activeTab === 'current' ? (
        impact ? (
          <div>
            <header style={{ marginBottom: '24px', borderBottom: '1px solid var(--vscode-widget-border)', paddingBottom: '16px' }}>
              <div className="flex-row" style={{ justifyContent: 'space-between', marginBottom: '12px' }}>
                <h1 className="title" style={{ margin: 0 }}>Impact Analysis: {impact.table}</h1>
                <RiskBadge level={impact.riskLevel} />
              </div>
              <div className="flex-row subtitle">
                <Info size={14} />
                <span>Operation: <code>{impact.operation}</code></span>
                {impact.estimationQuality === 'worst-case' && (
                  <span 
                    title="This number is based on PostgreSQL internal catalog statistics (n_live_tup). These statistics can be slightly outdated until an ANALYZE or autovacuum runs. Click 'Simulate' for 100% exact live counts."
                    style={{ 
                      marginLeft: '12px', 
                      background: 'var(--vscode-badge-background)', 
                      color: 'var(--vscode-badge-foreground)', 
                      padding: '2px 8px', 
                      borderRadius: '4px', 
                      fontSize: '0.65rem',
                      fontWeight: 'bold',
                      cursor: 'help',
                      border: '1px solid var(--vscode-button-background)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <Info size={10} />
                    WORST CASE ESTIMATION
                  </span>
                )}
                <button 
                  onClick={runSimulation}
                  disabled={simulationResult !== null}
                  style={{ 
                    marginLeft: 'auto', 
                    background: simulationResult === null ? 'var(--vscode-button-background)' : 'var(--vscode-button-secondaryBackground)',
                    color: simulationResult === null ? 'var(--vscode-button-foreground)' : 'var(--vscode-button-secondaryForeground)',
                    border: 'none',
                    borderRadius: '2px',
                    padding: '6px 16px',
                    cursor: simulationResult === null ? 'pointer' : 'default',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '0.75rem',
                    fontWeight: 'bold',
                    boxShadow: simulationResult === null ? '0 2px 4px rgba(0,0,0,0.2)' : 'none',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <Zap size={14} fill={simulationResult === null ? "currentColor" : "none"} /> 
                  {simulationResult === null ? 'RUN EXACT SIMULATION' : 'SIMULATION COMPLETE'}
                </button>
              </div>
              {simulationResult !== null && (
                <div style={{ 
                  marginTop: '12px', 
                  padding: '8px 12px', 
                  background: 'var(--vscode-editor-selectionBackground)', 
                  borderLeft: '4px solid var(--vscode-button-background)',
                  borderRadius: '4px', 
                  fontSize: '0.8rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                   <Zap size={14} color="var(--vscode-button-background)" />
                   <span>Simulation Result: <strong>{simulationResult.toLocaleString()} rows affected</strong> (No data modified)</span>
                </div>
              )}
            </header>

            <div className="dashboard-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '16px', marginBottom: '24px' }}>
              <section className="card" style={{ margin: 0 }}>
                <h2 className="subtitle" style={{ fontWeight: 'bold', fontSize: '0.7rem' }}>BLAST RADIUS</h2>
                <BlastRadiusChart affected={impact.baseRowsAffected} total={impact.tableTotalRows} />
              </section>

              <section className="card" style={{ margin: 0 }}>
                <h2 className="subtitle" style={{ fontWeight: 'bold', fontSize: '0.7rem' }}>DIRECT IMPACT</h2>
                <ImpactBar 
                  label={impact.table} 
                  affected={impact.baseRowsAffected} 
                  total={impact.tableTotalRows} 
                  quality={impact.estimationQuality}
                />
                {impact.riskLevel === 'DESTRUCTIVE' && (
                  <div className="flex-row destructive-text" style={{ marginTop: '8px', fontSize: '0.8rem' }}>
                    <AlertCircle size={14} />
                    <span>DANGER: This affects 100% of the table.</span>
                  </div>
                )}
              </section>
            </div>

            {impact.cascadeChain.length > 0 && (
              <section className="card">
                <h2 className="subtitle" style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <LayoutDashboard size={16} />
                  CASCADE VISUALIZATION
                </h2>
                <CascadeTreeMap results={impact.cascadeChain} />
                <div style={{ marginTop: '24px' }}>
                  <h2 className="subtitle" style={{ fontWeight: 'bold', fontSize: '0.7rem' }}>DETAILED FK CHAIN</h2>
                  <CascadeTree results={impact.cascadeChain} />
                </div>
              </section>
            )}
          </div>
        ) : (
          <div className="flex-row" style={{ height: '60vh', flexDirection: 'column', justifyContent: 'center', opacity: 0.6 }}>
            <Database size={48} />
            <p>Select a mutation in your code to see impact analysis.</p>
          </div>
        )
      ) : (
        <HistoryView history={history} onClear={clearHistory} />
      )}

      <footer style={{ marginTop: '32px', padding: '16px', opacity: 0.7, fontSize: '0.8rem', borderTop: '1px solid var(--vscode-widget-border)' }}>
        <p>Estimations are based on <code>pg_stat_user_tables</code>. Real impact may vary depending on active transactions.</p>
      </footer>
    </div>
  );
};

export default App;
