import * as assert from 'assert';
import { estimateDeleteCascade, estimateTruncate } from '../../src/core/impact/CascadeAnalyzer';
import { analyzeImpact, DEFAULT_IMPACT_OPTIONS } from '../../src/core/impact/ImpactEngine';
import { ProjectModel } from '../../src/core/project/ProjectModel';
import type { SchemaIndex } from '../../src/core/schema/types';
import { detectOne, fk, schemaIndex, table } from '../helpers';

const IMPORT = `import { eq } from 'drizzle-orm';\n`;

function impactOf(code: string, index: SchemaIndex | null, threshold = 10_000) {
    return analyzeImpact(detectOne(code), {
        index,
        project: new ProjectModel(),
        options: { ...DEFAULT_IMPACT_OPTIONS, criticalRowThreshold: threshold },
        file: 'src/a.ts',
    }).summary;
}

describe('Cascade estimation', () => {
    const index = schemaIndex(
        [
            table('users', 1000),
            table('posts', 50_000),
            table('comments', 200_000),
            table('orders', 10),
            table('audit', 30),
        ],
        [
            fk('posts', ['author_id'], 'users', 'CASCADE'),
            fk('comments', ['post_id'], 'posts', 'CASCADE'),
            fk('orders', ['user_id'], 'users', 'RESTRICT'),
            fk('audit', ['user_id'], 'users', 'SET NULL'),
        ]
    );

    it('scales child rows proportionally and recurses through CASCADE', () => {
        const r = estimateDeleteCascade(index, index.find('users')!, 10);
        const posts = r.nodes.find((n) => n.table === 'public.posts')!;
        assert.strictEqual(posts.rowsEstimated, 500);
        assert.strictEqual(posts.children[0].rowsEstimated, 2000);
        assert.strictEqual(r.deletedRows, 2500);
        assert.strictEqual(r.nullifiedRows, 1);
        assert.deepStrictEqual(r.blockers, ['public.orders']);
    });

    it('does not loop on self references', () => {
        const self = schemaIndex(
            [table('categories', 100)],
            [fk('categories', ['parent_id'], 'categories', 'CASCADE')]
        );
        const r = estimateDeleteCascade(self, self.find('categories')!, 5);
        assert.strictEqual(r.nodes[0].cyclic, true);
        assert.strictEqual(r.deletedRows, 0);
    });

    it('does not use "every child row" when parent statistics are missing', () => {
        const noStats = schemaIndex(
            [table('users', 0), table('posts', 50_000)],
            [fk('posts', ['author_id'], 'users', 'CASCADE')]
        );
        const r = estimateDeleteCascade(noStats, noStats.find('users')!, 1);
        assert.strictEqual(r.deletedRows, 1);
    });

    it('stops at the node budget in dense schemas', () => {
        const tables = [table('root', 10)];
        const fks = [];
        for (let i = 0; i < 30; i++) {
            tables.push(table(`t${i}`, 10));
            fks.push(fk(`t${i}`, ['root_id'], 'root', 'CASCADE'));
            for (let j = 0; j < 30; j++) fks.push(fk(`t${j}`, [`t${i}_id`], `t${i}`, 'CASCADE'));
        }
        const r = estimateDeleteCascade(schemaIndex(tables, fks), tables[0], 10);
        assert.strictEqual(r.truncated, true);
    });

    it('TRUNCATE without CASCADE is blocked by any reference; with CASCADE empties children', () => {
        assert.deepStrictEqual(
            estimateTruncate(index, index.find('users')!, false).blockers.sort(),
            ['public.audit', 'public.orders', 'public.posts']
        );
        const r = estimateTruncate(index, index.find('users')!, true);
        assert.strictEqual(r.deletedRows, 50_000 + 200_000 + 10 + 30);
    });
});

describe('Impact engine', () => {
    const index = schemaIndex(
        [table('User', 1000, ['id', 'email']), table('Post', 20_000, ['id', 'authorId'])],
        [fk('Post', ['authorId'], 'User', 'CASCADE')]
    );

    it('flags unfiltered bulk mutations as DESTRUCTIVE even without a database', () => {
        const s = impactOf('prisma.user.deleteMany()', null);
        assert.strictEqual(s.riskLevel, 'DESTRUCTIVE');
        assert.strictEqual(s.connected, false);
        assert.strictEqual(s.totalRows, null);
    });

    it('is UNKNOWN for filtered mutations without a database', () => {
        assert.strictEqual(
            impactOf('prisma.user.deleteMany({ where: { id: 1 } })', null).riskLevel,
            'UNKNOWN'
        );
    });

    it('estimates rows and cascades for an unfiltered delete', () => {
        const s = impactOf('prisma.user.deleteMany()', index);
        assert.strictEqual(s.table, 'public.User');
        assert.strictEqual(s.baseRows, 1000);
        assert.strictEqual(s.baseEstimate, 'estimated');
        assert.strictEqual(s.cascadeDeletedRows, 20_000);
        assert.strictEqual(s.totalRows, 21_000);
        assert.strictEqual(s.riskLevel, 'DESTRUCTIVE');
    });

    it('reports filtered bulk mutations as an upper bound WARNING (not CRITICAL)', () => {
        const s = impactOf(`prisma.user.deleteMany({ where: { email: 'x' } })`, index, 100);
        assert.strictEqual(s.baseEstimate, 'upper-bound');
        assert.strictEqual(s.riskLevel, 'WARNING');
    });

    it('rates single deletes by their cascade', () => {
        const s = impactOf('prisma.user.delete({ where: { id: 1 } })', index);
        assert.strictEqual(s.baseRows, 1);
        assert.strictEqual(s.cascadeDeletedRows, 20);
        assert.strictEqual(s.riskLevel, 'WARNING');
        assert.strictEqual(
            impactOf('prisma.user.delete({ where: { id: 1 } })', index, 10).riskLevel,
            'CRITICAL'
        );
        assert.strictEqual(
            impactOf('prisma.post.delete({ where: { id: 1 } })', index).riskLevel,
            'SAFE'
        );
    });

    it('never applies ON DELETE rules to updates', () => {
        const s = impactOf(`prisma.user.updateMany({ data: { email: 'x' } })`, index);
        assert.strictEqual(s.cascade.length, 0);
        assert.strictEqual(s.totalRows, 1000);
        assert.strictEqual(s.riskLevel, 'DESTRUCTIVE');
    });

    it('explains when the table cannot be found', () => {
        const s = impactOf(`${IMPORT}db.delete(ghosts).where(eq(ghosts.id, 1))`, index);
        assert.strictEqual(s.table, null);
        assert.strictEqual(s.riskLevel, 'UNKNOWN');
        assert.ok(s.reasons.some((r) => r.includes('not found')));
    });
});
