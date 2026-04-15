import { SchemaData } from '../db/types';
import { CascadeResult } from './types';

export class CascadeAnalyzer {
    constructor(private schema: SchemaData) {}

    public analyze(tableName: string, rowsAffected: number, visited: Set<string> = new Set()): CascadeResult[] {
        if (visited.has(tableName)) return [];
        visited.add(tableName);

        // Find FKs pointing TO the current table (impacted by delete/update)
        const relations = this.schema.relationships.filter(r => r.foreignTableName === tableName);
        const results: CascadeResult[] = [];

        for (const rel of relations) {
            if (visited.has(rel.tableName)) continue;

            const tableStats = this.schema.tables.find(t => t.tableName === rel.tableName);
            const totalRows = tableStats?.rowCount || 0;
            
            // Estimation: if we delete 10% of users, we roughly impact 10% of sessions
            // This is a naive estimation for v1.0 as per roadmap
            const estimatedImpact = Math.ceil((rowsAffected / (this.getTableCount(tableName) || 1)) * totalRows);

            results.push({
                table: rel.tableName,
                rowsEstimated: estimatedImpact,
                rule: rel.deleteRule,
                children: rel.deleteRule === 'CASCADE' ? this.analyze(rel.tableName, estimatedImpact, visited) : []
            });
        }

        return results;
    }

    private getTableCount(tableName: string): number {
        return this.schema.tables.find(t => t.tableName === tableName)?.rowCount || 0;
    }
}
