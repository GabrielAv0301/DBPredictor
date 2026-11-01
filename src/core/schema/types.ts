import type { FkRule } from '../../shared/types';

export interface TableInfo {
    schema: string;
    name: string;
    /** Planner estimate of live rows (n_live_tup / reltuples). */
    rowEstimate: number;
    /** Last ANALYZE / autoanalyze, ISO string. */
    lastAnalyzed: string | null;
    columns: string[];
}

export interface ForeignKeyInfo {
    name: string;
    /** Referencing (child) table. */
    schema: string;
    table: string;
    columns: string[];
    /** Referenced (parent) table. */
    refSchema: string;
    refTable: string;
    refColumns: string[];
    onDelete: FkRule;
}

export interface SchemaSnapshot {
    tables: TableInfo[];
    foreignKeys: ForeignKeyInfo[];
    /** Effective `search_path` schemas, in order. */
    searchPath: string[];
    fetchedAt: number;
}

export function qualified(schema: string, name: string): string {
    return `${schema}.${name}`;
}

export function tableId(t: Pick<TableInfo, 'schema' | 'name'>): string {
    return qualified(t.schema, t.name);
}

/** Lookup structure built once per schema snapshot. */
export class SchemaIndex {
    private readonly byId = new Map<string, TableInfo>();
    private readonly byName = new Map<string, TableInfo[]>();
    private readonly byLowerName = new Map<string, TableInfo[]>();
    private readonly incoming = new Map<string, ForeignKeyInfo[]>();

    constructor(public readonly snapshot: SchemaSnapshot) {
        for (const t of snapshot.tables) {
            this.byId.set(tableId(t), t);
            push(this.byName, t.name, t);
            push(this.byLowerName, t.name.toLowerCase(), t);
        }
        for (const fk of snapshot.foreignKeys) {
            push(this.incoming, qualified(fk.refSchema, fk.refTable), fk);
        }
    }

    public get(schema: string, name: string): TableInfo | undefined {
        return this.byId.get(qualified(schema, name));
    }

    /** Foreign keys that reference `table` (i.e. its children). */
    public referencing(table: TableInfo): ForeignKeyInfo[] {
        return this.incoming.get(tableId(table)) ?? [];
    }

    /**
     * Finds a table by name the way PostgreSQL would for an unqualified name
     * (search_path order), then falls back to any schema and finally to a
     * case-insensitive match (ORMs often differ in casing: `user` vs `"User"`).
     */
    public find(name: string, schema?: string): TableInfo | undefined {
        if (schema) {
            const exact = this.get(schema, name);
            if (exact) return exact;
            const lowerSchema = schema.toLowerCase();
            return (this.byLowerName.get(name.toLowerCase()) ?? []).find(
                (t) => t.schema.toLowerCase() === lowerSchema
            );
        }
        return (
            this.pick(this.byName.get(name)) ?? this.pick(this.byLowerName.get(name.toLowerCase()))
        );
    }

    public get tableCount(): number {
        return this.byId.size;
    }

    private pick(candidates: TableInfo[] | undefined): TableInfo | undefined {
        if (!candidates || candidates.length === 0) return undefined;
        if (candidates.length === 1) return candidates[0];
        for (const schema of this.snapshot.searchPath) {
            const hit = candidates.find((t) => t.schema === schema);
            if (hit) return hit;
        }
        return candidates.find((t) => t.schema === 'public') ?? candidates[0];
    }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
}
