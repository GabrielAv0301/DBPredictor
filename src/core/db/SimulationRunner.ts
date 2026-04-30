import { ImpactResult } from '../impact/types';
import { ConnectionManager } from './ConnectionManager';
import { Logger } from '../../utils/logger';
import { SqlParam } from './types';

export interface SimulationResult {
    rowCount: number;
    error?: string;
}

export class SimulationRunner {
    private static readonly SIMULATION_TIMEOUT_MS = 15000;

    public static async simulate(impact: ImpactResult): Promise<SimulationResult> {
        const conn = ConnectionManager.getInstance();
        if (!conn.getIsConnected()) {
            return { rowCount: 0, error: 'Database not connected' };
        }

        const { sql, params, error } = this.generateSimulationSql(impact);
        if (error || !sql) {
            return { rowCount: 0, error: error || 'Could not generate simulation SQL.' };
        }

        return new Promise((resolve) => {
            // Timeout to prevent infinite waiting. If reached, force disconnection to release the pool.
            const timeout = setTimeout(async () => {
                conn.setOnSimulationResult(undefined);
                Logger.error(
                    `Simulation timeout after ${this.SIMULATION_TIMEOUT_MS}ms. Forcing worker restart to clear connection pool.`
                );
                await conn.disconnect(); // This kills the worker and frees the pool slot

                // Automatically reconnect to restore the user's session state
                await conn.reconnect();

                resolve({
                    rowCount: 0,
                    error: `Simulation timed out (${this.SIMULATION_TIMEOUT_MS / 1000}s). The query was too heavy and has been cancelled.`,
                });
            }, this.SIMULATION_TIMEOUT_MS);

            conn.setOnSimulationResult((rowCount, error) => {
                clearTimeout(timeout);
                conn.setOnSimulationResult(undefined);
                resolve({ rowCount, error });
            });

            Logger.info('Starting secure simulation', { sql, params });
            conn.simulate(sql, params);
        });
    }

    // Generate parameterized and sanitized SQL for identifiers
    private static generateSimulationSql(impact: ImpactResult): {
        sql: string | null;
        params: SqlParam[];
        error?: string;
    } {
        const table = impact.table;
        const op = impact.operation;
        const params: SqlParam[] = [];

        // Protection against SQL Injection in Identifiers (Tables/Columns)
        // Allow alphanumeric, underscores, and dots for schemas.
        const identifierRegex = /^[a-zA-Z0-9_.]+$/;
        if (!identifierRegex.test(table)) {
            return {
                sql: null,
                params: [],
                error: `Security Alert: Invalid table name detected ("${table}"). Only alphanumeric, underscores and dots allowed.`,
            };
        }

        const safeTable = `"${table}"`;

        // Build parameterized WHERE clause if filters exist
        let whereClause = '';
        if (impact.hasWhere && impact.queryParams) {
            const conditions: string[] = [];
            for (const p of impact.queryParams) {
                if (!identifierRegex.test(p.column)) {
                    return {
                        sql: null,
                        params: [],
                        error: `Security Alert: Invalid column name detected ("${p.column}").`,
                    };
                }
                params.push(p.value as SqlParam);
                conditions.push(`"${p.column}" = $${params.length}`);
            }
            whereClause = ' WHERE ' + conditions.join(' AND ');
        }

        let sql: string | null = null;
        if (op === 'deleteMany' || op === 'delete') {
            sql = `DELETE FROM ${safeTable}${whereClause}`;
        } else if (op === 'updateMany' || op === 'update') {
            // Use a harmless operation that triggers cascades/triggers and returns rowCount
            sql = `UPDATE ${safeTable} SET "${impact.queryParams?.[0]?.column || 'id'}" = "${impact.queryParams?.[0]?.column || 'id'}"${whereClause}`;
        }

        return { sql, params };
    }
}
