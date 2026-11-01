import { analyzeSource, type SourceLanguage } from '../src/core/detectors';
import {
    DEFAULT_DETECTOR_OPTIONS,
    type DetectorOptions,
    type MutationInfo,
} from '../src/core/detectors/types';
import { SchemaIndex, type ForeignKeyInfo, type TableInfo } from '../src/core/schema/types';
import type { FkRule } from '../src/shared/types';

export function detect(
    code: string,
    options: Partial<DetectorOptions> = {},
    language: SourceLanguage = 'typescript'
): MutationInfo[] {
    return analyzeSource(code, 'file.ts', language, { ...DEFAULT_DETECTOR_OPTIONS, ...options });
}

export function detectOne(code: string, options: Partial<DetectorOptions> = {}): MutationInfo {
    const found = detect(code, options);
    if (found.length !== 1) {
        throw new Error(
            `Expected exactly one mutation, found ${found.length}: ${JSON.stringify(found.map((m) => m.sourceText))}`
        );
    }
    return found[0];
}

export function table(
    name: string,
    rows: number,
    columns: string[] = ['id'],
    schema = 'public'
): TableInfo {
    return { schema, name, rowEstimate: rows, lastAnalyzed: null, columns };
}

export function fk(
    child: string,
    columns: string[],
    parent: string,
    onDelete: FkRule,
    refColumns: string[] = ['id']
): ForeignKeyInfo {
    const [schema, name] = child.includes('.') ? child.split('.') : ['public', child];
    const [refSchema, refTable] = parent.includes('.') ? parent.split('.') : ['public', parent];
    return {
        name: `${name}_${columns.join('_')}_fkey`,
        schema,
        table: name,
        columns,
        refSchema,
        refTable,
        refColumns,
        onDelete,
    };
}

export function schemaIndex(
    tables: TableInfo[],
    foreignKeys: ForeignKeyInfo[] = [],
    searchPath = ['public']
): SchemaIndex {
    return new SchemaIndex({ tables, foreignKeys, searchPath, fetchedAt: Date.now() });
}

/** In-memory Memento / SecretStorage replacements. */
export class MemoryStore {
    public readonly data = new Map<string, unknown>();
    get<T>(key: string): T | undefined {
        return this.data.get(key) as T | undefined;
    }
    async update(key: string, value: unknown): Promise<void> {
        if (value === undefined) this.data.delete(key);
        else this.data.set(key, structuredClone(value));
    }
}

export class MemorySecrets {
    public readonly data = new Map<string, string>();
    async get(key: string): Promise<string | undefined> {
        return this.data.get(key);
    }
    async store(key: string, value: string): Promise<void> {
        this.data.set(key, value);
    }
    async delete(key: string): Promise<void> {
        this.data.delete(key);
    }
}
