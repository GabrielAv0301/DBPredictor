import * as assert from 'assert';
import { buildReport } from '../../src/core/simulation/report';
import { planSimulation } from '../../src/core/simulation/SimulationPlanner';
import { ProjectModel } from '../../src/core/project/ProjectModel';
import { quoteIdent } from '../../src/core/sql/identifiers';
import { detectOne, fk, schemaIndex, table } from '../helpers';

const index = schemaIndex(
    [
        table('User', 10, ['id', 'email', 'deletedAt']),
        table('Post', 100, ['id', 'authorId']),
        table('Comment', 1000, ['id', 'postId']),
        table('Invoice', 5, ['id', 'userId']),
        table('Audit', 5, ['id', 'userId']),
    ],
    [
        fk('Post', ['authorId'], 'User', 'CASCADE'),
        fk('Comment', ['postId'], 'Post', 'CASCADE'),
        fk('Invoice', ['userId'], 'User', 'RESTRICT'),
        fk('Audit', ['userId'], 'User', 'SET NULL'),
    ]
);
const project = new ProjectModel();

function plan(code: string, supplied = new Map()) {
    const m = detectOne(code);
    return planSimulation(
        m,
        index.find(m.table.name.replace(/^./, (c) => c.toUpperCase()))!,
        index,
        project,
        supplied
    );
}

describe('quoteIdent', () => {
    it('escapes embedded quotes and rejects NUL', () => {
        assert.strictEqual(quoteIdent('a"b'), '"a""b"');
        assert.throws(() => quoteIdent('a\u0000'));
    });
});

describe('Simulation planner', () => {
    it('counts with bind parameters and IS NULL', () => {
        const p = plan(`prisma.user.deleteMany({ where: { email: "o'hara", deletedAt: null } })`);
        assert.strictEqual(
            p.queries[0].sql,
            'SELECT count(*) AS n FROM "public"."User" WHERE "email" = $1 AND "deletedAt" IS NULL'
        );
        assert.deepStrictEqual(p.params, ["o'hara"]);
        assert.strictEqual(p.exact, true);
    });

    it('follows CASCADE recursively and counts SET NULL / RESTRICT edges', () => {
        const p = plan('prisma.user.delete({ where: { id: 7 } })');
        assert.deepStrictEqual(
            p.queries.map((q) => [q.table, q.rule, q.depth]),
            [
                ['public.User', 'BASE', 0],
                ['public.Post', 'CASCADE', 1],
                ['public.Comment', 'CASCADE', 2],
                ['public.Invoice', 'RESTRICT', 1],
                ['public.Audit', 'SET NULL', 1],
            ]
        );
        assert.strictEqual(
            p.queries[2].sql,
            'SELECT count(*) AS n FROM "public"."Comment" WHERE "postId" IN (SELECT "id" FROM "public"."Post" WHERE "authorId" IN (SELECT "id" FROM "public"."User" WHERE "id" = $1))'
        );
        assert.deepStrictEqual(p.params, [7]);
    });

    it('does not follow foreign keys for updates', () => {
        const p = plan(`prisma.user.updateMany({ where: { id: 1 }, data: {} })`);
        assert.strictEqual(p.queries.length, 1);
    });

    it('drops runtime values unless supplied, and reports an upper bound', () => {
        const dropped = plan('prisma.user.deleteMany({ where: { id: userId } })');
        assert.strictEqual(dropped.exact, false);
        assert.ok(dropped.queries[0].sql.endsWith('WHERE TRUE'));

        const supplied = plan(
            'prisma.user.deleteMany({ where: { id: userId } })',
            new Map([[0, '42']])
        );
        assert.strictEqual(supplied.exact, true);
        assert.deepStrictEqual(supplied.params, ['42']);
    });

    it('uses = ANY($n) for IN lists', () => {
        const p = plan(`prisma.user.deleteMany({ where: { id: { in: [1, 2, 3] } } })`);
        assert.ok(p.queries[0].sql.includes('"id" = ANY($1)'));
        assert.deepStrictEqual(p.params, [[1, 2, 3]]);
    });

    it('ignores filters on unknown columns with a warning', () => {
        const p = plan(`prisma.user.deleteMany({ where: { nope: 1 } })`);
        assert.strictEqual(p.exact, false);
        assert.ok(p.warnings[0].includes('nope'));
    });

    it('never puts values into the SQL text', () => {
        const evil = `x'; DROP TABLE "User"; --`;
        const p = plan(`prisma.user.deleteMany({ where: { email: ${JSON.stringify(evil)} } })`);
        for (const q of p.queries) assert.ok(!q.sql.includes('DROP'));
        assert.deepStrictEqual(p.params, [evil]);
    });

    it('every query references exactly the shared parameters', () => {
        const p = plan(`prisma.user.delete({ where: { id: 1, email: 'a' } })`);
        for (const q of p.queries) {
            assert.ok(q.sql.includes('$1') && q.sql.includes('$2'), q.sql);
        }
    });
});

describe('Simulation accuracy flags (audit #6, #11)', () => {
    it('keeps the base count exact but flags cascades through self references', () => {
        const self = schemaIndex(
            [table('Comment', 10, ['id', 'parentId'])],
            [fk('Comment', ['parentId'], 'Comment', 'CASCADE')]
        );
        const m = detectOne('prisma.comment.delete({ where: { id: 1 } })');
        const p = planSimulation(m, self.find('Comment')!, self, project);
        assert.strictEqual(p.exact, true);
        assert.strictEqual(p.cascadeApproximate, true);
    });

    it('does not claim a failure when the blocking table is also emptied by a cascade', () => {
        const diamond = schemaIndex(
            [table('A', 1), table('B', 1, ['id', 'a_id']), table('C', 1, ['id', 'a_id', 'b_id'])],
            [
                fk('B', ['a_id'], 'A', 'CASCADE'),
                fk('C', ['a_id'], 'A', 'CASCADE'),
                fk('C', ['b_id'], 'B', 'RESTRICT'),
            ]
        );
        const m = detectOne(`supabase.from('A').delete().eq('id', 1)`);
        const p = planSimulation(m, diamond.find('A')!, diamond, project);
        const counts = p.queries.map(() => 1);
        const report = buildReport(p, counts, 1, false);
        assert.deepStrictEqual(report.blockedBy, []);
        assert.ok(report.warnings.some((w) => w.includes('may or may not fail')));
    });
});

describe('Simulation report', () => {
    it('aggregates counts and blockers', () => {
        const p = plan('prisma.user.delete({ where: { id: 7 } })');
        const report = buildReport(p, [1, 3, 9, 2, 4], 12, false);
        assert.strictEqual(report.baseRows, 1);
        assert.strictEqual(report.cascadeDeletedRows, 12);
        assert.strictEqual(report.nullifiedRows, 4);
        assert.deepStrictEqual(report.blockedBy, [{ table: 'public.Invoice', rows: 2 }]);
        assert.ok(
            !report.warnings.some((w) => w.includes('would fail')),
            'no duplicated failure message'
        );
    });

    it('does not report RESTRICT edges without rows as blockers', () => {
        const p = plan('prisma.user.delete({ where: { id: 7 } })');
        assert.deepStrictEqual(buildReport(p, [1, 0, 0, 0, 0], 1, false).blockedBy, []);
    });
});
