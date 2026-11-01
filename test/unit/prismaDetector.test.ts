import * as assert from 'assert';
import { detect, detectOne } from '../helpers';

describe('Prisma detection', () => {
    it('detects deleteMany without arguments as unfiltered', () => {
        const m = detectOne('await prisma.user.deleteMany();');
        assert.strictEqual(m.orm, 'prisma');
        assert.strictEqual(m.operation, 'deleteMany');
        assert.deepStrictEqual(m.table, { kind: 'prisma-model', name: 'user' });
        assert.strictEqual(m.hasWhere, false);
    });

    it('treats an empty where object as unfiltered', () => {
        assert.strictEqual(detectOne('prisma.user.deleteMany({ where: {} })').hasWhere, false);
    });

    it('treats `field: undefined` as no condition (Prisma ignores it)', () => {
        const m = detectOne('prisma.user.deleteMany({ where: { email: undefined } })');
        assert.strictEqual(m.hasWhere, false);
    });

    it('extracts literal and runtime filters', () => {
        const m = detectOne(
            `prisma.post.updateMany({ where: { published: false, authorId: userId }, data: { x: 1 } })`
        );
        assert.strictEqual(m.hasWhere, true);
        assert.strictEqual(m.filtersComplete, true);
        assert.deepStrictEqual(m.filters, [
            { field: 'published', operator: 'eq', value: { kind: 'literal', value: false } },
            { field: 'authorId', operator: 'eq', value: { kind: 'expression', text: 'userId' } },
        ]);
    });

    it('translates null to IS NULL and shorthand properties', () => {
        const m = detectOne('prisma.session.deleteMany({ where: { revokedAt: null, userId } })');
        assert.deepStrictEqual(m.filters, [
            { field: 'revokedAt', operator: 'isNull' },
            { field: 'userId', operator: 'eq', value: { kind: 'expression', text: 'userId' } },
        ]);
    });

    it('translates operator objects', () => {
        const m = detectOne(
            `prisma.log.deleteMany({ where: { createdAt: { lt: cutoff }, level: { in: ['debug', 'trace'] }, msg: { contains: '50%' } } })`
        );
        assert.deepStrictEqual(m.filters, [
            { field: 'createdAt', operator: 'lt', value: { kind: 'expression', text: 'cutoff' } },
            {
                field: 'level',
                operator: 'in',
                value: { kind: 'literal', value: ['debug', 'trace'] },
            },
            { field: 'msg', operator: 'like', value: { kind: 'literal', value: '%50\\%%' } },
        ]);
        assert.strictEqual(m.filtersComplete, true);
    });

    it('marks OR / relation filters as incomplete but filtered', () => {
        const m = detectOne(
            `prisma.user.deleteMany({ where: { OR: [{ a: 1 }, { b: 2 }], posts: { some: {} } } })`
        );
        assert.strictEqual(m.hasWhere, true);
        assert.strictEqual(m.filtersComplete, false);
        assert.deepStrictEqual(m.filters, []);
    });

    it('flattens AND', () => {
        const m = detectOne(`prisma.user.deleteMany({ where: { AND: [{ a: 1 }, { b: 'x' }] } })`);
        assert.strictEqual(m.filters.length, 2);
        assert.strictEqual(m.filtersComplete, true);
    });

    it('handles a where passed as a variable', () => {
        const m = detectOne('prisma.user.deleteMany({ where })');
        assert.strictEqual(m.hasWhere, true);
        assert.strictEqual(m.filtersComplete, false);
        const n = detectOne('prisma.user.deleteMany(args)');
        assert.strictEqual(n.hasWhere, true);
    });

    it('supports this.prisma, tx and transactions', () => {
        const found = detect(`
            await this.prisma.user.delete({ where: { id: 1 } });
            await prisma.$transaction(async (tx) => { await tx.post.deleteMany({ where: { authorId: 1 } }); });
        `);
        assert.deepStrictEqual(
            found.map((m) => [m.operation, m.table.name]),
            [
                ['delete', 'user'],
                ['deleteMany', 'post'],
            ]
        );
    });

    it('does not report Map#delete or unrelated objects', () => {
        assert.deepStrictEqual(
            detect('cache.users.delete(key); map.delete(id); prisma.user.delete(id);'),
            []
        );
        assert.deepStrictEqual(detect('foo.user.deleteMany()'), []);
    });

    it('detects raw SQL mutations and ignores raw SELECTs', () => {
        const found = detect(`
            await prisma.$queryRaw\`SELECT * FROM users\`;
            await prisma.$executeRaw\`DELETE FROM "User" WHERE id = \${id}\`;
            await prisma.$executeRawUnsafe('TRUNCATE sessions');
        `);
        assert.deepStrictEqual(
            found.map((m) => [m.orm, m.operation, m.table.name, m.hasWhere]),
            [
                ['raw-sql', 'deleteMany', 'User', true],
                ['raw-sql', 'truncate', 'sessions', false],
            ]
        );
    });

    it('honours queryguard-ignore comments', () => {
        const [m] = detect('// queryguard-ignore\nawait prisma.user.deleteMany();');
        assert.strictEqual(m.ignored, true);
        const [n] = detect('await prisma.user.deleteMany(); // queryguard-ignore');
        assert.strictEqual(n.ignored, true);
    });

    it('reports positions', () => {
        const [m] = detect('\n\n    await prisma.user.deleteMany();');
        assert.deepStrictEqual(m.range.start, { line: 2, character: 10 });
    });

    it('respects custom client names', () => {
        assert.strictEqual(detect('repo.user.deleteMany()').length, 0);
        assert.strictEqual(
            detect('repo.user.deleteMany()', { prismaClientNames: ['repo'] }).length,
            1
        );
    });
});
