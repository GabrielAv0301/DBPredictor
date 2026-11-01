/** Quotes a PostgreSQL identifier. Safe for any input (doubles embedded quotes). */
export function quoteIdent(name: string): string {
    if (name.includes('\u0000')) throw new Error('Invalid identifier: contains a NUL character.');
    return `"${name.replace(/"/g, '""')}"`;
}

export function quoteTable(schema: string, name: string): string {
    return `${quoteIdent(schema)}.${quoteIdent(name)}`;
}
