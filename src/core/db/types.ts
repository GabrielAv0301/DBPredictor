import { SSLMode } from '../../config/SSLConfig';

export interface TableStats {
    tableName: string;
    rowCount: number;
    lastAnalyze?: string | null;
    lastAutoAnalyze?: string | null;
}

export interface ForeignKeyRelationship {
    tableName: string;
    columnName: string;
    foreignTableName: string;
    deleteRule: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
    isNullable?: boolean;
}

export interface SchemaData {
    tables: TableStats[];
    relationships: ForeignKeyRelationship[];
    timestamp: number;
}

export type SqlParam = string | number | boolean | null;

export type WorkerMessage =
    | { type: 'CONNECT'; connectionString: string; sslMode?: SSLMode }
    | { type: 'QUERY_SCHEMA' }
    | { type: 'SIMULATE'; sql: string; params: SqlParam[] }
    | { type: 'DISCONNECT' };

export type WorkerResponse =
    | { type: 'CONNECTED'; success: true }
    | { type: 'CONNECTED'; success: false; error: string }
    | { type: 'SCHEMA_DATA'; data: SchemaData }
    | { type: 'SIMULATION_RESULT'; rowCount: number; error?: string; warnCascade?: string }
    | { type: 'ERROR'; error: string };
