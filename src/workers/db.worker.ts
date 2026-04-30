import { parentPort } from 'worker_threads';
import { Pool, PoolConfig } from 'pg';
import { WorkerMessage, SqlParam } from '../core/db/types';
import { SSLMode, buildPGSSLConfig } from '../config/SSLConfig';

let pool: Pool | null = null;

if (parentPort) {
    parentPort.on('message', async (message: WorkerMessage) => {
        try {
            switch (message.type) {
                case 'CONNECT':
                    await handleConnect(message.connectionString, message.sslMode);
                    break;
                case 'QUERY_SCHEMA':
                    await handleQuerySchema();
                    break;
                case 'SIMULATE':
                    await handleSimulate(message.sql, message.params);
                    break;
                case 'DISCONNECT':
                    await handleDisconnect();
                    break;
            }
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            parentPort?.postMessage({ type: 'ERROR', error: errorMessage });
        }
    });
}

const POOL_CONNECTION_TIMEOUT_MS = 10000;
const POOL_IDLE_TIMEOUT_MS = 10000;
const POOL_MAX_CONNECTIONS = 1;

async function handleConnect(connectionString: string, sslMode?: SSLMode): Promise<void> {
    if (pool) {
        await pool.end();
    }

    const poolConfig: PoolConfig = {
        connectionString,
        connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
        idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
        max: POOL_MAX_CONNECTIONS,
    };

    // SSL is only disabled for local connections; for remote, use the configured mode
    if (sslMode !== undefined && sslMode !== SSLMode.DISABLE) {
        poolConfig.ssl = buildPGSSLConfig(sslMode);
    } else {
        // For local connections (no SSL mode specified), SSL is disabled by default
        poolConfig.ssl = undefined;
    }

    pool = new Pool(poolConfig);

    try {
        const client = await pool.connect();
        client.release();
        parentPort?.postMessage({ type: 'CONNECTED', success: true });
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        parentPort?.postMessage({ type: 'CONNECTED', success: false, error: errorMessage });
    }
}

async function handleQuerySchema(): Promise<void> {
    if (!pool) throw new Error('Database not connected');

    const tablesQuery =
        'SELECT relname as "tableName", n_live_tup as "rowCount" FROM pg_stat_user_tables;';
    const fkQuery = `
        SELECT
            tc.table_name as "tableName",
            kcu.column_name as "columnName",
            ccu.table_name AS "foreignTableName",
            rc.delete_rule as "deleteRule"
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
        JOIN information_schema.constraint_column_usage ccu ON rc.unique_constraint_name = ccu.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY';
    `;

    const [tablesRes, fkRes] = await Promise.all([pool.query(tablesQuery), pool.query(fkQuery)]);

    parentPort?.postMessage({
        type: 'SCHEMA_DATA',
        data: {
            tables: tablesRes.rows,
            relationships: fkRes.rows,
            timestamp: Date.now(),
        },
    });
}

async function handleSimulate(sql: string, params: SqlParam[]): Promise<void> {
    if (!pool) throw new Error('Database not connected');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const res = await client.query(sql, params);
        await client.query('ROLLBACK');
        parentPort?.postMessage({ type: 'SIMULATION_RESULT', rowCount: res.rowCount || 0 });
    } catch (error: unknown) {
        await client.query('ROLLBACK');
        parentPort?.postMessage({
            type: 'SIMULATION_RESULT',
            rowCount: 0,
            error: error instanceof Error ? error.message : String(error),
        });
    } finally {
        client.release();
    }
}

async function handleDisconnect(): Promise<void> {
    if (pool) {
        await pool.end();
        pool = null;
    }
}
