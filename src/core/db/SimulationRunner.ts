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
            // Timeout para evitar esperas infinitas. Si se cumple, forzamos la desconexión para liberar el pool.
            const timeout = setTimeout(async () => {
                conn.setOnSimulationResult(undefined);
                Logger.error(`Simulation timeout after ${this.SIMULATION_TIMEOUT_MS}ms. Forcing worker restart to clear connection pool.`);
                await conn.disconnect(); // Esto mata al worker y libera el slot del pool
                resolve({ rowCount: 0, error: `Simulation timed out (${this.SIMULATION_TIMEOUT_MS / 1000}s). The query was too heavy and has been cancelled.` });
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

    // Generar SQL parametrizado y sanitizado para identificadores
    private static generateSimulationSql(impact: ImpactResult): { sql: string | null, params: SqlParam[], error?: string } {
        const table = impact.table;
        const op = impact.operation;
        const params: SqlParam[] = [];
        
        // Blindaje contra SQL Injection en Identificadores (Tablas/Columnas)
        // Solo permitimos caracteres alfanuméricos y guiones bajos para identificadores dinámicos.
        // Si detectamos algo sospechoso (comillas, punto y coma, comentarios), abortamos.
        const identifierRegex = /^[a-zA-Z0-9_]+$/;
        if (!identifierRegex.test(table)) {
            return { sql: null, params: [], error: `Security Alert: Invalid table name detected ("${table}"). Only alphanumeric and underscores allowed.` };
        }

        const safeTable = `"${table}"`;

        // Construir cláusula WHERE parametrizada si existen filtros
        let whereClause = '';
        if (impact.hasWhere && impact.queryParams) {
            const conditions: string[] = [];
            for (const p of impact.queryParams) {
                if (!identifierRegex.test(p.column)) {
                    return { sql: null, params: [], error: `Security Alert: Invalid column name detected ("${p.column}").` };
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
            // Usamos una operación inocua que dispare los triggers/cascadas y devuelva rowCount
            sql = `UPDATE ${safeTable} SET "${impact.queryParams?.[0]?.column || 'id'}" = "${impact.queryParams?.[0]?.column || 'id'}"${whereClause}`;
        }

        return { sql, params };
    }
}
