import { MutationInfo } from '../detectors/DetectorInterface';
import { SchemaData } from '../db/types';
import { ImpactResult, RiskLevel, CascadeResult, EstimationQuality } from './types';
import { CascadeAnalyzer } from './CascadeAnalyzer';

export class ImpactEngine {
    public static calculate(mutation: MutationInfo, schema: SchemaData): ImpactResult {
        const tableStats = schema.tables.find(t => t.tableName === mutation.table);
        const totalRowsInTable = tableStats?.rowCount || 0;
        
        let baseRowsAffected = 1; 
        let estimationQuality: EstimationQuality = 'exact';

        if (mutation.operation === 'deleteMany' || mutation.operation === 'updateMany') {
            if (mutation.hasWhere) {
                // Bloque 1.1: Peor caso (total de la tabla) pero marcado como worst-case
                baseRowsAffected = totalRowsInTable;
                estimationQuality = 'worst-case';
            } else {
                baseRowsAffected = totalRowsInTable;
                estimationQuality = 'exact';
            }
        } else {
            // delete / update (single record)
            baseRowsAffected = 1;
            estimationQuality = 'exact';
        }

        const analyzer = new CascadeAnalyzer(schema);
        const cascadeChain = analyzer.analyze(mutation.table, baseRowsAffected);
        
        const totalRowsAffected = this.sumCascadeRows(cascadeChain) + baseRowsAffected;
        const willFailByRestrict = this.checkRestrictViolation(cascadeChain);

        const riskLevel = this.classifyRisk(mutation, baseRowsAffected, totalRowsAffected);

        return {
            table: mutation.table,
            operation: mutation.operation,
            hasWhere: mutation.hasWhere,
            whereClause: mutation.whereClause,
            queryParams: mutation.queryParams,
            baseRowsAffected,
            totalRowsAffected,
            tableTotalRows: totalRowsInTable,
            estimationQuality,
            riskLevel,
            cascadeChain,
            willFailByRestrict
        };
    }

    private static sumCascadeRows(results: CascadeResult[]): number {
        return results.reduce((acc, curr) => acc + curr.rowsEstimated + this.sumCascadeRows(curr.children), 0);
    }

    private static checkRestrictViolation(results: CascadeResult[]): boolean {
        return results.some(r => r.rule === 'RESTRICT' || r.rule === 'NO ACTION' || this.checkRestrictViolation(r.children));
    }

    private static classifyRisk(mutation: MutationInfo, base: number, total: number): RiskLevel {
        const isBulk = mutation.operation === 'deleteMany' || mutation.operation === 'updateMany';
        const isSingleRecord = mutation.operation === 'delete' || mutation.operation === 'update';

        // Masiva sin filtro = peligro máximo
        if (isBulk && !mutation.hasWhere) return 'DESTRUCTIVE';

        // Impacto crítico por volumen
        if (total > 10000) return 'CRITICAL';

        // Registro único — siempre relativamente seguro
        if (isSingleRecord) return 'SAFE';

        // Masiva con filtro — riesgo moderado
        return 'WARNING';
    }
}
