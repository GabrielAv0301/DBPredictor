import type { CascadeNode } from '../../shared/types';
import { tableId, type SchemaIndex, type TableInfo } from '../schema/types';

export const MAX_CASCADE_DEPTH = 8;
/** Guards against exponential growth in densely connected schemas. */
export const MAX_CASCADE_NODES = 400;

export interface CascadeEstimate {
    nodes: CascadeNode[];
    /** Rows deleted through ON DELETE CASCADE. */
    deletedRows: number;
    /** Rows whose foreign key is set to NULL / DEFAULT. */
    nullifiedRows: number;
    /** Tables with RESTRICT / NO ACTION references to rows being deleted. */
    blockers: string[];
    /** The depth limit was reached. */
    truncated: boolean;
}

/**
 * Estimates the effect of deleting `affectedRows` rows of `table` on the
 * tables that reference it.
 *
 * Assumes referencing rows are distributed uniformly across parent rows:
 * deleting 10% of `users` removes ~10% of `posts`. This is a statistical
 * estimate — the read-only simulation gives exact numbers.
 */
export function estimateDeleteCascade(
    index: SchemaIndex,
    table: TableInfo,
    affectedRows: number,
    maxDepth = MAX_CASCADE_DEPTH
): CascadeEstimate {
    const result: CascadeEstimate = {
        nodes: [],
        deletedRows: 0,
        nullifiedRows: 0,
        blockers: [],
        truncated: false,
    };
    const blockers = new Set<string>();
    let budget = MAX_CASCADE_NODES;

    const walk = (parent: TableInfo, rows: number, path: Set<string>, depth: number) => {
        const nodes: CascadeNode[] = [];
        if (rows <= 0) return nodes;
        if (depth > maxDepth) {
            result.truncated = true;
            return nodes;
        }
        for (const fk of index.referencing(parent)) {
            if (--budget < 0) {
                result.truncated = true;
                break;
            }
            const child = index.get(fk.schema, fk.table);
            const childId = `${fk.schema}.${fk.table}`;
            const childRows = child?.rowEstimate ?? 0;
            // Without parent statistics, assume one referencing row per parent row
            // rather than "every child row", which would wildly overstate the impact.
            const parentRows = parent.rowEstimate > 0 ? parent.rowEstimate : Math.max(childRows, 1);
            const ratio = Math.min(1, rows / parentRows);
            const estimated = Math.min(childRows, Math.ceil(ratio * childRows));
            const cyclic = path.has(childId);
            const node: CascadeNode = {
                table: childId,
                columns: fk.columns,
                rule: fk.onDelete,
                rowsEstimated: estimated,
                cyclic,
                children: [],
            };

            switch (fk.onDelete) {
                case 'CASCADE':
                    if (!cyclic) {
                        result.deletedRows += estimated;
                        if (child) {
                            node.children = walk(
                                child,
                                estimated,
                                new Set(path).add(childId),
                                depth + 1
                            );
                        }
                    }
                    break;
                case 'SET NULL':
                case 'SET DEFAULT':
                    if (!cyclic) result.nullifiedRows += estimated;
                    break;
                default:
                    // RESTRICT / NO ACTION: the statement fails if referencing rows exist.
                    if (estimated > 0 && !cyclic) blockers.add(childId);
            }
            nodes.push(node);
        }
        return nodes;
    };

    result.nodes = walk(table, affectedRows, new Set([tableId(table)]), 1);
    result.blockers = [...blockers];
    return result;
}

/**
 * TRUNCATE ignores ON DELETE rules: without CASCADE it fails when any other
 * table references it; with CASCADE every referencing table is emptied.
 */
export function estimateTruncate(
    index: SchemaIndex,
    table: TableInfo,
    cascade: boolean
): CascadeEstimate {
    const result: CascadeEstimate = {
        nodes: [],
        deletedRows: 0,
        nullifiedRows: 0,
        blockers: [],
        truncated: false,
    };
    const seen = new Set<string>([tableId(table)]);

    const walk = (parent: TableInfo, depth: number): CascadeNode[] => {
        const nodes: CascadeNode[] = [];
        for (const fk of index.referencing(parent)) {
            const childId = `${fk.schema}.${fk.table}`;
            const child = index.get(fk.schema, fk.table);
            const cyclic = seen.has(childId);
            if (!cascade) {
                if (!cyclic) result.blockers.push(childId);
                continue;
            }
            const node: CascadeNode = {
                table: childId,
                columns: fk.columns,
                rule: 'CASCADE',
                rowsEstimated: cyclic ? 0 : (child?.rowEstimate ?? 0),
                cyclic,
                children: [],
            };
            if (!cyclic) {
                seen.add(childId);
                result.deletedRows += node.rowsEstimated;
                if (child && depth < MAX_CASCADE_DEPTH) node.children = walk(child, depth + 1);
                else if (child) result.truncated = true;
            }
            nodes.push(node);
        }
        return nodes;
    };

    result.nodes = walk(table, 1);
    result.blockers = [...new Set(result.blockers)];
    return result;
}
