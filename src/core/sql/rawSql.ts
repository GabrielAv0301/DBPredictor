/**
 * Best-effort classification of raw SQL strings found in code
 * (`prisma.$executeRaw`, `db.execute(sql\`…\`)`).
 *
 * This is NOT a SQL parser. It only answers: does this text contain a
 * DELETE / UPDATE / TRUNCATE statement, on which table, and is it filtered?
 * Read-only statements (SELECT, INSERT…) are ignored.
 */

export interface RawSqlMutation {
    operation: 'deleteMany' | 'updateMany' | 'truncate';
    /** Unquoted table name, or null when it could not be determined (e.g. interpolated). */
    table: string | null;
    schema?: string;
    hasWhere: boolean;
    truncateCascade: boolean;
}

const IDENT = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][\w$]*|\$\d+)`;
const QUALIFIED = String.raw`(${IDENT}(?:\s*\.\s*${IDENT})?)`;

const DELETE_RE = new RegExp(String.raw`\bdelete\s+from\s+(?:only\s+)?${QUALIFIED}`, 'gi');
const UPDATE_RE = new RegExp(String.raw`\bupdate\s+(?:only\s+)?${QUALIFIED}`, 'gi');
const TRUNCATE_RE = new RegExp(
    String.raw`^\s*truncate\s+(?:table\s+)?(?:only\s+)?${QUALIFIED}`,
    'i'
);
/** Words that can follow UPDATE without it being an UPDATE statement (FOR UPDATE SKIP LOCKED…). */
const NOT_A_TABLE = new Set(['skip', 'nowait', 'of', 'set', 'where', 'returning']);

const SEVERITY: Record<RawSqlMutation['operation'], number> = {
    truncate: 3,
    deleteMany: 2,
    updateMany: 1,
};

/** Removes comments and string literals (incl. dollar-quoted) so keywords inside are ignored. */
export function stripSqlNoise(sql: string): string {
    return sql
        .replace(/--[^\n]*/g, ' ')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(\$[A-Za-z_]*\$)[\s\S]*?\1/g, "''")
        .replace(/'(?:[^']|'')*'/g, "''");
}

function unquote(ident: string): string {
    const trimmed = ident.trim();
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        return trimmed.slice(1, -1).replace(/""/g, '"');
    }
    return trimmed;
}

function splitQualified(text: string): { schema?: string; table: string | null } {
    const parts = text.split(/\s*\.\s*(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(unquote);
    const table = parts[parts.length - 1];
    const schema = parts.length > 1 ? parts[0] : undefined;
    // `$1` means the name was interpolated at runtime: unknown.
    if (/^\$\d+$/.test(table) || (schema !== undefined && /^\$\d+$/.test(schema))) {
        return { table: null };
    }
    return { schema, table };
}

function firstKeyword(statement: string): string {
    const match = /^\s*\(*\s*([A-Za-z]+)/.exec(statement);
    return match ? match[1].toLowerCase() : '';
}

/** Parenthesis depth at every character. */
function depths(text: string): number[] {
    const out = new Array<number>(text.length);
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === ')') depth = Math.max(0, depth - 1);
        out[i] = depth;
        if (text[i] === '(') depth++;
    }
    return out;
}

/** True when a WHERE belongs to the clause starting at `from` (sub-queries ignored). */
function hasOwnWhere(statement: string, depth: number[], from: number): boolean {
    const level = depth[from] ?? 0;
    for (let i = from; i < statement.length; i++) {
        if (depth[i] < level) return false; // the enclosing parenthesis closed
        if (depth[i] === level && /^where\b/i.test(statement.slice(i, i + 6))) {
            if (i === 0 || !/\w/.test(statement[i - 1])) return true;
        }
    }
    return false;
}

function isWorse(a: RawSqlMutation, b: RawSqlMutation | null): boolean {
    if (!b) return true;
    if (SEVERITY[a.operation] !== SEVERITY[b.operation]) {
        return SEVERITY[a.operation] > SEVERITY[b.operation];
    }
    return !a.hasWhere && b.hasWhere;
}

function classifyStatement(statement: string): RawSqlMutation | null {
    const keyword = firstKeyword(statement);
    if (!['delete', 'update', 'truncate', 'with'].includes(keyword)) return null;

    if (keyword === 'truncate') {
        const m = TRUNCATE_RE.exec(statement);
        if (!m) return null;
        const { schema, table } = splitQualified(m[1]);
        return {
            operation: 'truncate',
            table,
            schema,
            hasWhere: false,
            truncateCascade: /\bcascade\b/i.test(statement),
        };
    }

    // A statement may contain several mutations (data-modifying CTEs): keep the worst.
    const depth = depths(statement);
    let worst: RawSqlMutation | null = null;
    const scan = (re: RegExp, operation: 'deleteMany' | 'updateMany') => {
        re.lastIndex = 0;
        for (let m = re.exec(statement); m; m = re.exec(statement)) {
            const before = statement.slice(0, m.index).trimEnd().toLowerCase();
            // SELECT … FOR [NO KEY] UPDATE is a row lock, not an UPDATE statement.
            if (operation === 'updateMany' && /\b(for|key)$/.test(before)) continue;
            const { schema, table } = splitQualified(m[1]);
            if (table && NOT_A_TABLE.has(table.toLowerCase())) continue;
            const candidate: RawSqlMutation = {
                operation,
                table,
                schema,
                hasWhere: hasOwnWhere(statement, depth, m.index + m[0].length),
                truncateCascade: false,
            };
            if (isWorse(candidate, worst)) worst = candidate;
        }
    };
    scan(DELETE_RE, 'deleteMany');
    scan(UPDATE_RE, 'updateMany');
    return worst;
}

/**
 * Returns the most dangerous mutating statement in `sql`, or null when the
 * text only contains read-only statements.
 */
export function classifyRawSql(sql: string): RawSqlMutation | null {
    const statements = stripSqlNoise(sql)
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);

    let worst: RawSqlMutation | null = null;
    for (const statement of statements) {
        const result = classifyStatement(statement);
        if (result && isWorse(result, worst)) worst = result;
    }
    return worst;
}
