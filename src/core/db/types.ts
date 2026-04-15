export interface TableStats {
    tableName: string;
    rowCount: number;
}

export interface ForeignKeyRelationship {
    tableName: string;
    columnName: string;
    foreignTableName: string;
    deleteRule: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
}

export interface SchemaData {
    tables: TableStats[];
    relationships: ForeignKeyRelationship[];
    timestamp: number;
}

export type SqlParam = string | number | boolean | null;

export type WorkerMessage = 
    | { type: 'CONNECT'; connectionString: string }
    | { type: 'QUERY_SCHEMA' }
    | { type: 'SIMULATE'; sql: string; params: SqlParam[] }
    | { type: 'DISCONNECT' };

export type WorkerResponse = 
    | { type: 'CONNECTED'; success: true }
    | { type: 'CONNECTED'; success: false; error: string }
    | { type: 'SCHEMA_DATA'; data: SchemaData }
    | { type: 'SIMULATION_RESULT'; rowCount: number; error?: string }
    | { type: 'ERROR'; error: string };
