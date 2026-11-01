import type { SchemaSnapshot } from '../core/schema/types';
import type { SqlParam } from '../core/simulation/SimulationPlanner';

/** TLS options that can cross the worker boundary (functions can't be cloned). */
export type WorkerSslOptions =
    | false
    | {
          rejectUnauthorized: boolean;
          /** PEM content of the CA bundle, when configured. */
          ca?: string;
          /** verify-ca: validate the chain but not the host name. */
          skipHostnameCheck?: boolean;
      };

export interface ConnectPayload {
    connectionString: string;
    ssl: WorkerSslOptions;
    applicationName: string;
}

export interface CountRequest {
    queries: string[];
    params: SqlParam[];
    /** Server-side limit for each count query. */
    statementTimeoutMs: number;
    /** Budget for the whole simulation (default: 4 × statementTimeoutMs). */
    totalTimeoutMs?: number;
}

export function totalBudgetMs(
    request: Pick<CountRequest, 'statementTimeoutMs' | 'totalTimeoutMs'>
): number {
    return request.totalTimeoutMs ?? request.statementTimeoutMs * 4;
}

export interface CountResult {
    counts: number[];
    durationMs: number;
}

export interface ConnectResult {
    serverVersion: number;
}

export type WorkerRequest =
    | { id: number; type: 'connect'; payload: ConnectPayload }
    | { id: number; type: 'fetchSchema' }
    | { id: number; type: 'count'; payload: CountRequest }
    | { id: number; type: 'disconnect' };

export type WorkerResultMap = {
    connect: ConnectResult;
    fetchSchema: SchemaSnapshot;
    count: CountResult;
    disconnect: void;
};

export interface WorkerErrorInfo {
    message: string;
    /** PostgreSQL SQLSTATE or Node error code (`ECONNREFUSED`…). */
    code?: string;
}

export type WorkerResponse =
    | { kind: 'response'; id: number; ok: true; result: unknown }
    | { kind: 'response'; id: number; ok: false; error: WorkerErrorInfo }
    | { kind: 'log'; level: 'info' | 'warn' | 'error'; message: string };
