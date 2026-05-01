import { SchemaData } from '../db/types';
import { CascadeResult } from './types';

export class CascadeAnalyzer {
    constructor(private schema: SchemaData) {}

    public analyze(
        tableName: string,
        rowsAffected: number,
        visited: Set<string> = new Set()
    ): CascadeResult[] {
        if (visited.has(tableName)) return [];
        visited.add(tableName);

        const relations = this.schema.relationships.filter((r) => r.foreignTableName === tableName);
        const results: CascadeResult[] = [];

        for (const rel of relations) {
            if (visited.has(rel.tableName)) continue;

            const tableStats = this.schema.tables.find((t) => t.tableName === rel.tableName);
            const totalRows = tableStats?.rowCount || 0;

            let estimatedImpact: number;
            if (rel.deleteRule === 'CASCADE') {
                estimatedImpact = Math.ceil(
                    (rowsAffected / (this.getTableCount(tableName) || 1)) * totalRows
                );
            } else if (rel.deleteRule === 'SET NULL') {
                // Solo las filas donde la FK actual tiene un valor (no NULL) serán afectadas
                // Por defecto estimamos 50% si no sabemos la proporción real de nulos.
                // TODO: Podríamos consultar information_schema para obtener stats de nulabilidad.
                estimatedImpact = Math.ceil(totalRows * 0.5);
            } else {
                // RESTRICT / NO ACTION: el impacto directo es 0;
                // el efecto es que la operación puede FALLAR, no que borre filas.
                estimatedImpact = 0;
            }

            results.push({
                table: rel.tableName,
                rowsEstimated: estimatedImpact,
                rule: rel.deleteRule,
                children:
                    rel.deleteRule === 'CASCADE'
                        ? this.analyze(rel.tableName, estimatedImpact, visited)
                        : [],
            });
        }

        return results;
    }

    private getTableCount(tableName: string): number {
        return this.schema.tables.find((t) => t.tableName === tableName)?.rowCount || 0;
    }
}
