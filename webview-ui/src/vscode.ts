import type { FromWebviewMessage } from '../../src/shared/types';

interface VsCodeApi {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
}

declare global {
    interface Window {
        acquireVsCodeApi?: () => VsCodeApi;
    }
}

// acquireVsCodeApi may only be called once per webview.
const api: VsCodeApi | undefined = window.acquireVsCodeApi?.();

export function post(message: FromWebviewMessage): void {
    api?.postMessage(message);
}

export interface PersistedState {
    tab: 'impact' | 'history';
}

export function loadState(): PersistedState {
    const state = api?.getState() as Partial<PersistedState> | undefined;
    return { tab: state?.tab === 'history' ? 'history' : 'impact' };
}

export function saveState(state: PersistedState): void {
    api?.setState(state);
}
