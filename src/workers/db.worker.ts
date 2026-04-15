import { parentPort } from 'worker_threads';
import { Pool } from 'pg';
import { WorkerMessage, SqlParam } from '../core/db/types';

let pool: Pool | null = null;

if (parentPort) {
    parentPort.on('message', async (message: WorkerMessage) => {
        try {
            switch (message.type) {
                case 'CONNECT':
                    await handleConnect(message.connectionString);
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

async function handleConnect(connectionString: string) {
    if (pool) {
        await pool.end();
    }

    // Análisis de la cadena de conexión para SSL
    const isLocal = connectionString.includes('localhost') || 
                   connectionString.includes('127.0.0.1') || 
                   connectionString.includes('0.0.0.0');

    const poolConfig: any = {
        connectionString,
        connectionTimeoutMillis: 10000, // Aumentamos el timeout a 10s para redes lentas
        idleTimeoutMillis: 10000,
        max: 1
    };

    // Solo activar SSL si no es local, para evitar el error "Server does not support SSL"
    if (!isLocal) {
        poolConfig.ssl = {
            rejectUnauthorized: false
        };
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

async function handleQuerySchema() {
    if (!pool) throw new Error('Database not connected');

    const tablesQuery = 'SELECT relname as "tableName", n_live_tup as "rowCount" FROM pg_stat_user_tables;';
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

    const [tablesRes, fkRes] = await Promise.all([
        pool.query(tablesQuery),
        pool.query(fkQuery)
    ]);

    parentPort?.postMessage({
        type: 'SCHEMA_DATA',
        data: {
            tables: tablesRes.rows,
            relationships: fkRes.rows,
            timestamp: Date.now()
        }
    });
}

async function handleSimulate(sql: string, params: SqlParam[]) {
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
            error: error instanceof Error ? error.message : String(error) 
        });
    } finally {
        client.release();
    }
}

async function handleDisconnect() {
    if (pool) {
        await pool.end();
        pool = null;
    }
}
