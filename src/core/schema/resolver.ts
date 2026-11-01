import type { TableRef } from '../detectors/types';
import type { ProjectModel } from '../project/ProjectModel';
import type { SchemaIndex, TableInfo } from './types';

export function toSnakeCase(name: string): string {
    return name
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
        .toLowerCase();
}

function upperFirst(name: string): string {
    return name.charAt(0).toUpperCase() + name.slice(1);
}

function unique(values: (string | undefined)[]): string[] {
    return [...new Set(values.filter((v): v is string => !!v))];
}

export interface TableResolution {
    table: TableInfo | undefined;
    /** Names that were tried, for user-facing messages. */
    tried: string[];
}

/**
 * Maps the table referenced in code to a real database table, using the
 * project's ORM definitions when available and naming conventions otherwise.
 */
export function resolveTable(
    ref: TableRef,
    index: SchemaIndex,
    project: ProjectModel
): TableResolution {
    let schema: string | undefined;
    let names: string[];

    switch (ref.kind) {
        case 'prisma-model': {
            const model = project.prismaModel(ref.name);
            schema = model?.schema;
            names = unique([model?.dbName, upperFirst(ref.name), ref.name, toSnakeCase(ref.name)]);
            break;
        }
        case 'drizzle-variable': {
            const table = project.drizzleTable(ref.name);
            schema = table?.schema;
            names = unique([table?.name, ref.name, toSnakeCase(ref.name)]);
            break;
        }
        case 'sql-name':
            schema = ref.schema;
            names = [ref.name];
            break;
        default:
            return { table: undefined, tried: [] };
    }

    for (const name of names) {
        const table = index.find(name, schema);
        if (table) return { table, tried: names };
    }
    return { table: undefined, tried: names };
}

/** Maps a field used in code to a column of `table`, or undefined when it does not exist. */
export function resolveColumn(
    field: string,
    table: TableInfo,
    ref: TableRef,
    project: ProjectModel
): string | undefined {
    let mapped: string | undefined;
    if (ref.kind === 'prisma-model') mapped = project.prismaModel(ref.name)?.fields[field];
    if (ref.kind === 'drizzle-variable') mapped = project.drizzleTable(ref.name)?.columns[field];

    const candidates = unique([mapped, field, toSnakeCase(field)]);
    for (const candidate of candidates) {
        if (table.columns.includes(candidate)) return candidate;
    }
    for (const candidate of candidates) {
        const lower = candidate.toLowerCase();
        const hit = table.columns.find((c) => c.toLowerCase() === lower);
        if (hit) return hit;
    }
    return undefined;
}
