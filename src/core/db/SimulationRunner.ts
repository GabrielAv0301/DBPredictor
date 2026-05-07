import { ImpactResult } from '../impact/types';
import { ConnectionManager } from './ConnectionManager';
import { Logger } from '../../utils/logger';
import { SqlParam } from './types';

export interface SimulationResult {
    rowCount: number;
    error?: string;
    warnCascade?: string;
}

export class SimulationRunner {
    private static readonly SIMULATION_TIMEOUT_MS = 15000;

    public static async simulate(impact: ImpactResult): Promise<SimulationResult> {
        const conn = ConnectionManager.getInstance();
        if (!conn.getIsConnected()) {
            return { rowCount: 0, error: 'Database not connected' };
        }

        const { sql, params, error, warnCascade } = this.generateSimulationSql(impact);
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
                resolve({ rowCount, error, warnCascade });
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
        warnCascade?: string;
    } {
        const table = impact.table;
        const op = impact.operation;
        const params: SqlParam[] = [];

        // Protection against SQL Injection in Identifiers (Tables/Columns)
        // Allow alphanumeric and underscores. Dots are handled by splitting.
        const partRegex = /^\w+$/;

        const tableParts = table.split('.');
        if (tableParts.length > 2 || tableParts.some((p) => !partRegex.test(p))) {
            return {
                sql: null,
                params: [],
                error: `Security Alert: Invalid table name detected ("${table}"). Only alphanumeric and underscores allowed (optional one dot for schema).`,
            };
        }

        const safeTable = tableParts.map((p) => `"${p}"`).join('.');

        // Build parameterized WHERE clause if filters exist
        let whereClause = '';
        if (impact.hasWhere && impact.queryParams) {
            const conditions: string[] = [];
            for (const p of impact.queryParams) {
                if (!partRegex.test(p.column)) {
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
        let warnCascade: string | undefined;

        if (op === 'deleteMany' || op === 'delete') {
            sql = `DELETE FROM ${safeTable}${whereClause}`;
        } else if (op === 'updateMany' || op === 'update') {
            // Para UPDATE, usamos el mismo DELETE para simular porque un UPDATE
            // no dispara ON DELETE CASCADE (solo ON UPDATE CASCADE).
            // Esto nos da el rowCount real incluyendo filas afectadas por SET NULL / RESTRICT.
            if (impact.cascadeChain.length > 0) {
                warnCascade =
                    'UPDATE cannot trigger DELETE cascades. Cascade estimation is informational.';
            }
            sql = `DELETE FROM ${safeTable}${whereClause}`;
        }

        return { sql, params, warnCascade };
    }
}
