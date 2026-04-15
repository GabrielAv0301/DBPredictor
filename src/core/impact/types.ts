import { MutationOperation } from '../detectors/DetectorInterface';

export type RiskLevel = 'SAFE' | 'WARNING' | 'CRITICAL' | 'DESTRUCTIVE';
export type EstimationQuality = 'exact' | 'worst-case' | 'estimated';

export interface CascadeResult {
    table: string;
    rowsEstimated: number;
    rule: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
    children: CascadeResult[];
}

export interface ImpactResult {
    table: string;
    operation: MutationOperation;
    hasWhere: boolean;
    whereClause?: string;
    queryParams?: { column: string, value: unknown }[];
    baseRowsAffected: number;
    totalRowsAffected: number;
    tableTotalRows: number; // Real row count from stats
    estimationQuality: EstimationQuality;
    riskLevel: RiskLevel;
    cascadeChain: CascadeResult[];
    willFailByRestrict: boolean;
}
