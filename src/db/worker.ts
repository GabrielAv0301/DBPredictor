/**
 * Database worker thread. Owns the `pg` pool so that network I/O and slow
 * queries never block the extension host.
 *
 * Safety contract: every query this worker runs is executed inside a
 * `READ ONLY` transaction with a server-side statement timeout and is always
 * rolled back. PostgreSQL itself rejects any write attempted in such a
 * transaction (SQLSTATE 25006).
 */
import { parentPort } from 'worker_threads';
import { Pool, type PoolClient, type PoolConfig } from 'pg';
import type { ConnectionOptions } from 'tls';
import type {
    ConnectPayload,
    ConnectResult,
    CountRequest,
    CountResult,
    WorkerErrorInfo,
    WorkerRequest,
    WorkerResponse,
} from './protocol';
import { totalBudgetMs } from './protocol';
import {
    FOREIGN_KEYS_SQL,
    SEARCH_PATH_SQL,
    TABLES_SQL,
    toSnapshot,
    type ForeignKeyRow,
    type TableRow,
} from './schemaQueries';

const CONNECT_TIMEOUT_MS = 10_000;
const IDLE_TIMEOUT_MS = 30_000;
const LOCK_TIMEOUT_MS = 3_000;
const SCHEMA_TIMEOUT_MS = 30_000;
const MIN_SERVER_VERSION = 110000;

let pool: Pool | null = null;

function send(message: WorkerResponse): void {
    parentPort?.postMessage(message);
}

function toErrorInfo(error: unknown): WorkerErrorInfo {
    if (error instanceof Error) {
        const code = (error as { code?: unknown }).code;
        return { message: error.message, code: typeof code === 'string' ? code : undefined };
    }
    return { message: String(error) };
}

function sslConfig(payload: ConnectPayload): PoolConfig['ssl'] {
    if (payload.ssl === false) return false;
    const options: ConnectionOptions = { rejectUnauthorized: payload.ssl.rejectUnauthorized };
    if (payload.ssl.ca) options.ca = payload.ssl.ca;
    if (payload.ssl.skipHostnameCheck) options.checkServerIdentity = () => undefined;
    return options;
}

async function closePool(): Promise<void> {
    const current = pool;
    pool = null;
    if (current) {
        try {
            await current.end();
        } catch (error) {
            send({
                kind: 'log',
                level: 'warn',
                message: `Error closing pool: ${toErrorInfo(error).message}`,
            });
        }
    }
}

/** Runs `work` inside BEGIN READ ONLY … ROLLBACK with server-side timeouts. */
async function readOnly<T>(
    timeoutMs: number,
    work: (client: PoolClient) => Promise<T>
): Promise<T> {
    if (!pool)
        throw Object.assign(new Error('Not connected to a database.'), {
            code: 'QG_NOT_CONNECTED',
        });
    const client = await pool.connect();
    let broken: Error | undefined;
    try {
        await client.query('BEGIN TRANSACTION READ ONLY');
        await client.query(`SET LOCAL statement_timeout = ${Math.max(1, Math.trunc(timeoutMs))}`);
        await client.query(`SET LOCAL lock_timeout = ${LOCK_TIMEOUT_MS}`);
        return await work(client);
    } catch (error) {
        broken = error instanceof Error ? error : new Error(String(error));
        throw error;
    } finally {
        try {
            await client.query('ROLLBACK');
            client.release();
        } catch {
            // The connection is unusable: destroy it instead of returning it to the pool.
            client.release(broken ?? true);
        }
    }
}

async function connect(payload: ConnectPayload): Promise<ConnectResult> {
    await closePool();
    const next = new Pool({
        connectionString: payload.connectionString,
        ssl: sslConfig(payload),
        max: 2,
        connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
        idleTimeoutMillis: IDLE_TIMEOUT_MS,
        application_name: payload.applicationName,
    });
    // Idle clients can be dropped by the server; the pool replaces them on demand.
    next.on('error', (error) => {
        send({ kind: 'log', level: 'warn', message: `Idle connection error: ${error.message}` });
    });

    try {
        const result = await next.query<{ version: string }>(
            "SELECT current_setting('server_version_num') AS version"
        );
        const serverVersion = Number(result.rows[0]?.version ?? 0);
        if (serverVersion > 0 && serverVersion < MIN_SERVER_VERSION) {
            throw Object.assign(
                new Error(
                    `PostgreSQL ${Math.floor(serverVersion / 10000)} is not supported (11 or newer required).`
                ),
                { code: 'QG_UNSUPPORTED_VERSION' }
            );
        }
        pool = next;
        return { serverVersion };
    } catch (error) {
        await next.end().catch(() => undefined);
        throw error;
    }
}

async function fetchSchema() {
    return readOnly(SCHEMA_TIMEOUT_MS, async (client) => {
        const tables = await client.query<TableRow>(TABLES_SQL);
        const fks = await client.query<ForeignKeyRow>(FOREIGN_KEYS_SQL);
        const path = await client.query<{ searchPath: string[] }>(SEARCH_PATH_SQL);
        return toSnapshot(tables.rows, fks.rows, path.rows[0]?.searchPath ?? ['public']);
    });
}

async function count(request: CountRequest): Promise<CountResult> {
    const started = Date.now();
    const budget = totalBudgetMs(request);
    const counts = await readOnly(request.statementTimeoutMs, async (client) => {
        const results: number[] = [];
        for (const sql of request.queries) {
            // Keep the whole simulation within its budget, enforced by the server.
            const remaining = budget - (Date.now() - started);
            if (remaining <= 0) {
                throw Object.assign(new Error('The simulation exceeded its time budget.'), {
                    code: '57014',
                });
            }
            const limit = Math.max(1, Math.trunc(Math.min(request.statementTimeoutMs, remaining)));
            await client.query(`SET LOCAL statement_timeout = ${limit}`);
            const res = await client.query<{ n: string }>(sql, request.params);
            results.push(Number(res.rows[0]?.n ?? 0));
        }
        return results;
    });
    return { counts, durationMs: Date.now() - started };
}

async function handle(request: WorkerRequest): Promise<unknown> {
    switch (request.type) {
        case 'connect':
            return connect(request.payload);
        case 'fetchSchema':
            return fetchSchema();
        case 'count':
            return count(request.payload);
        case 'disconnect':
            await closePool();
            return undefined;
    }
}

parentPort?.on('message', (request: WorkerRequest) => {
    handle(request).then(
        (result) => send({ kind: 'response', id: request.id, ok: true, result }),
        (error: unknown) =>
            send({ kind: 'response', id: request.id, ok: false, error: toErrorInfo(error) })
    );
});
