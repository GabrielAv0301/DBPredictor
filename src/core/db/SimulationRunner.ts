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
        return new Promise((resolve) => {
            const conn = ConnectionManager.getInstance();
            if (!conn.getIsConnected()) {
                resolve({ rowCount: 0, error: 'Database not connected' });
                return;
            }

            const { sql, params } = this.generateSimulationSql(impact);
            if (!sql) {
                resolve({ rowCount: 0, error: 'Could not generate simulation SQL. Ensure filters are fixed literals.' });
                return;
            }

            // Timeout para evitar esperas infinitas
            const timeout = setTimeout(() => {
                conn.setOnSimulationResult(undefined);
                resolve({ rowCount: 0, error: `Simulation timed out (${this.SIMULATION_TIMEOUT_MS / 1000}s).` });
            }, this.SIMULATION_TIMEOUT_MS);

            conn.setOnSimulationResult((rowCount, error) => {
                clearTimeout(timeout);
                conn.setOnSimulationResult(undefined);
                resolve({ rowCount, error });
            });

            Logger.info('Starting simulation', { sql, params });
            conn.simulate(sql, params);
        });
    }

    // Generar SQL parametrizado ($1, $2...) para evitar inyecciones
    private static generateSimulationSql(impact: ImpactResult): { sql: string | null, params: SqlParam[] } {
        const table = impact.table;
        const op = impact.operation;
        const params: SqlParam[] = [];
        let sql: string | null = null;

        // Construir cláusula WHERE parametrizada si existen filtros
        let whereClause = '';
        if (impact.hasWhere && impact.queryParams) {
            whereClause = ' WHERE ' + impact.queryParams.map((p, i) => {
                params.push(p.value as SqlParam);
                return `"${p.column}" = $${i + 1}`;
            }).join(' AND ');
        }

        if (op === 'deleteMany' || op === 'delete') {
            sql = `DELETE FROM "${table}"${whereClause}`;
        } else if (op === 'updateMany' || op === 'update') {
            sql = `UPDATE "${table}" SET id = id${whereClause}`;
        }

        return { sql, params };
    }
}
