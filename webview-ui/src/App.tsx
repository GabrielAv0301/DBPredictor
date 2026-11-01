import { History, Zap } from 'lucide-react';
import { useEffect, useReducer, type ReactNode } from 'react';
import type {
    ConnectionInfo,
    HistoryEntry,
    ImpactSummary,
    SimulationReport,
    ToWebviewMessage,
} from '../../src/shared/types';
import { HistoryView } from './components/HistoryView';
import { ImpactView } from './components/ImpactView';
import { loadState, post, saveState, type PersistedState } from './vscode';

interface State {
    tab: PersistedState['tab'];
    impact: ImpactSummary | null;
    connection: ConnectionInfo;
    history: HistoryEntry[];
    simulating: boolean;
    report: SimulationReport | undefined;
}

type Action = ToWebviewMessage | { type: 'tab'; tab: PersistedState['tab'] };

function sameMutation(a: ImpactSummary | null, b: ImpactSummary | null): boolean {
    return !!a && !!b && a.file === b.file && a.key === b.key;
}

function reducer(state: State, action: Action): State {
    switch (action.type) {
        case 'tab':
            return { ...state, tab: action.tab };
        case 'impact': {
            const keep = sameMutation(state.impact, action.impact);
            return {
                ...state,
                impact: action.impact,
                connection: action.connection,
                report: keep ? state.report : undefined,
                simulating: keep ? state.simulating : false,
                tab: keep ? state.tab : 'impact',
            };
        }
        case 'connection':
            return { ...state, connection: action.connection };
        case 'history':
            return { ...state, history: action.entries };
        case 'simulationStarted':
            return { ...state, simulating: true };
        case 'simulationFinished':
            return { ...state, simulating: false, report: action.report };
        default:
            return state;
    }
}

const MESSAGE_TYPES = new Set([
    'impact',
    'connection',
    'history',
    'simulationStarted',
    'simulationFinished',
]);

export function App() {
    const [state, dispatch] = useReducer(reducer, undefined, () => ({
        tab: loadState().tab,
        impact: null,
        connection: { connected: false },
        history: [],
        simulating: false,
        report: undefined,
    }));

    useEffect(() => {
        const onMessage = (event: MessageEvent<unknown>) => {
            const data = event.data as { type?: unknown } | null;
            if (data && typeof data.type === 'string' && MESSAGE_TYPES.has(data.type)) {
                dispatch(data as ToWebviewMessage);
            }
        };
        window.addEventListener('message', onMessage);
        // Announce readiness exactly once, after the listener is in place.
        post({ type: 'ready' });
        return () => window.removeEventListener('message', onMessage);
    }, []);

    useEffect(() => saveState({ tab: state.tab }), [state.tab]);

    const tab = (name: PersistedState['tab'], label: string, icon: ReactNode) => (
        <button
            role="tab"
            aria-selected={state.tab === name}
            className={`tab ${state.tab === name ? 'active' : ''}`}
            onClick={() => dispatch({ type: 'tab', tab: name })}
        >
            {icon}
            {label}
        </button>
    );

    return (
        <main className="app">
            <nav className="tabs" role="tablist">
                {tab('impact', 'Impact', <Zap size={14} />)}
                {tab('history', `History (${state.history.length})`, <History size={14} />)}
                <span className="spacer" />
                <span className={`connection ${state.connection.connected ? 'on' : 'off'}`}>
                    {state.connection.connected
                        ? `● ${state.connection.profileName ?? 'connected'}`
                        : '○ not connected'}
                </span>
            </nav>
            {state.tab === 'impact' ? (
                <ImpactView
                    impact={state.impact}
                    connection={state.connection}
                    simulating={state.simulating}
                    report={state.report}
                />
            ) : (
                <HistoryView entries={state.history} />
            )}
            <footer className="muted small">
                Estimates use PostgreSQL planner statistics and may be outdated; the exact count
                queries live data.
            </footer>
        </main>
    );
}
