/**
 * Minimal Prisma schema reader: model → table (`@@map`, `@@schema`) and
 * field → column (`@map`). Only what is needed to translate Prisma Client
 * calls into SQL identifiers.
 */

export interface PrismaModel {
    name: string;
    /** Database table name (`@@map`) — defaults to the model name. */
    dbName: string;
    /** `@@schema("…")` (multiSchema preview feature). */
    schema?: string;
    /** Scalar field name → column name. Relation fields are excluded. */
    fields: Record<string, string>;
}

function stripLineComment(line: string): string {
    let inString = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"' && line[i - 1] !== '\\') inString = !inString;
        if (!inString && c === '/' && line[i + 1] === '/') return line.slice(0, i);
    }
    return line;
}

const MAP_RE = /@map\(\s*(?:name\s*:\s*)?"([^"]+)"/;
const BLOCK_MAP_RE = /^@@map\(\s*(?:name\s*:\s*)?"([^"]+)"/;
const BLOCK_SCHEMA_RE = /^@@schema\(\s*"([^"]+)"/;
const SCALAR_TYPES = new Set([
    'String',
    'Boolean',
    'Int',
    'BigInt',
    'Float',
    'Decimal',
    'DateTime',
    'Json',
    'Bytes',
]);
const FIELD_RE = /^([A-Za-z_]\w*)\s+([A-Za-z_][\w.]*)(\[\])?(\?)?(.*)$/;

export function parsePrismaSchema(text: string): PrismaModel[] {
    const lines = text.split(/\r?\n/).map(stripLineComment);
    const blocks: { name: string; body: string[] }[] = [];

    for (let i = 0; i < lines.length; i++) {
        const header = /^\s*model\s+([A-Za-z_]\w*)\s*\{\s*$/.exec(lines[i]);
        if (!header) continue;
        const body: string[] = [];
        let j = i + 1;
        while (j < lines.length && lines[j].trim() !== '}') {
            body.push(lines[j].trim());
            j++;
        }
        blocks.push({ name: header[1], body });
        i = j;
    }

    const modelNames = new Set(blocks.map((b) => b.name));
    return blocks.map(({ name, body }) => {
        const model: PrismaModel = { name, dbName: name, fields: {} };
        for (const line of body) {
            if (!line) continue;
            if (line.startsWith('@@')) {
                const map = BLOCK_MAP_RE.exec(line);
                if (map) model.dbName = map[1];
                const schema = BLOCK_SCHEMA_RE.exec(line);
                if (schema) model.schema = schema[1];
                continue;
            }
            const field = FIELD_RE.exec(line);
            if (!field) continue;
            const [, fieldName, type, isList, , attributes] = field;
            // Relation fields are not columns. With multi-file schemas the related
            // model may live in another file, hence the list heuristic.
            const isRelation =
                modelNames.has(type) ||
                attributes.includes('@relation') ||
                (isList !== undefined && !SCALAR_TYPES.has(type));
            if (isRelation) continue;
            const map = MAP_RE.exec(attributes);
            model.fields[fieldName] = map ? map[1] : fieldName;
        }
        return model;
    });
}

/** Prisma Client exposes model `UserProfile` as `prisma.userProfile`. */
export function prismaAccessorName(modelName: string): string {
    return modelName.charAt(0).toLowerCase() + modelName.slice(1);
}
