import * as assert from 'assert';
import { detect, detectOne } from '../helpers';

const IMPORT = `import { eq, and, lt, inArray, isNull, or, sql } from 'drizzle-orm';\n`;

describe('Drizzle detection', () => {
    it('detects delete without where as unfiltered', () => {
        const m = detectOne(`${IMPORT}await db.delete(users);`);
        assert.strictEqual(m.orm, 'drizzle');
        assert.strictEqual(m.operation, 'deleteMany');
        assert.deepStrictEqual(m.table, { kind: 'drizzle-variable', name: 'users' });
        assert.strictEqual(m.hasWhere, false);
    });

    it('extracts eq / and / inArray / isNull', () => {
        const m = detectOne(
            `${IMPORT}db.delete(posts).where(and(eq(posts.authorId, id), inArray(posts.status, ['a', 'b']), isNull(posts.deletedAt)))`
        );
        assert.strictEqual(m.hasWhere, true);
        assert.strictEqual(m.filtersComplete, true);
        assert.deepStrictEqual(m.filters, [
            { field: 'authorId', operator: 'eq', value: { kind: 'expression', text: 'id' } },
            { field: 'status', operator: 'in', value: { kind: 'literal', value: ['a', 'b'] } },
            { field: 'deletedAt', operator: 'isNull' },
        ]);
    });

    it('marks or() / sql`` as incomplete but filtered (no false DESTRUCTIVE)', () => {
        const m = detectOne(`${IMPORT}db.delete(posts).where(or(eq(posts.a, 1), eq(posts.b, 2)))`);
        assert.strictEqual(m.hasWhere, true);
        assert.strictEqual(m.filtersComplete, false);
        const n = detectOne(`${IMPORT}db.update(posts).set({ x: 1 }).where(sql\`true\`)`);
        assert.strictEqual(n.hasWhere, true);
    });

    it('treats where(undefined) and where(and(undefined)) as no filter (audit #5)', () => {
        assert.strictEqual(detectOne(`${IMPORT}db.delete(users).where(undefined)`).hasWhere, false);
        assert.strictEqual(
            detectOne(`${IMPORT}db.delete(users).where(and(undefined))`).hasWhere,
            false
        );
    });

    it('detects chains ending in .execute() / .then() / .prepare() (audit #1)', () => {
        for (const tail of ['.execute()', '.then(cb)', '.prepare("p")', '.returning().execute()']) {
            const m = detectOne(`${IMPORT}await db.delete(sessions)${tail};`);
            assert.strictEqual(m.hasWhere, false, tail);
        }
        assert.strictEqual(
            detectOne(`${IMPORT}db.delete(s).where(eq(s.id, 1)).execute()`).hasWhere,
            true
        );
    });

    it('supports schema.table, tx and this.db', () => {
        const found = detect(`${IMPORT}
            await tx.update(schema.accounts).set({ balance: 0 });
            await this.db.delete(sessions).where(lt(sessions.expiresAt, now));
        `);
        assert.deepStrictEqual(
            found.map((m) => [m.operation, m.table.name, m.hasWhere]),
            [
                ['updateMany', 'accounts', false],
                ['deleteMany', 'sessions', true],
            ]
        );
    });

    it('does not confuse Map / KV stores with Drizzle', () => {
        assert.deepStrictEqual(detect('db.delete(key);'), []);
        assert.deepStrictEqual(detect('db.update(key, value);'), []);
    });

    it('accepts a delete when the table is known from the project index', () => {
        const found = detect('db.delete(users);', { isKnownDrizzleTable: (n) => n === 'users' });
        assert.strictEqual(found.length, 1);
    });

    it('detects raw db.execute(sql``)', () => {
        const m = detectOne(
            `${IMPORT}await db.execute(sql\`DELETE FROM sessions WHERE user_id = \${id}\`);`
        );
        assert.strictEqual(m.orm, 'raw-sql');
        assert.strictEqual(m.table.name, 'sessions');
        assert.strictEqual(m.hasWhere, true);
    });

    it('ignores column-to-column comparisons as values', () => {
        const m = detectOne(`${IMPORT}db.delete(t).where(eq(t.a, t.b))`);
        assert.strictEqual(m.filtersComplete, false);
        assert.strictEqual(m.filters.length, 0);
    });
});
