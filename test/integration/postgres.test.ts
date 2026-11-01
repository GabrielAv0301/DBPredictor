/**
 * Runs the real database worker against a real PostgreSQL.
 *   QG_TEST_DATABASE_URL=postgresql://postgres:pw@localhost:5432/db npm run test:integration
 * Skipped when the variable is not set.
 */
import * as assert from 'assert';
import * as path from 'path';
import { Client } from 'pg';
import { analyzeSource } from '../../src/core/detectors';
import { DEFAULT_DETECTOR_OPTIONS } from '../../src/core/detectors/types';
import { analyzeImpact, DEFAULT_IMPACT_OPTIONS } from '../../src/core/impact/ImpactEngine';
import { ProjectModel } from '../../src/core/project/ProjectModel';
import { SchemaIndex } from '../../src/core/schema/types';
import { buildReport } from '../../src/core/simulation/report';
import { planSimulation } from '../../src/core/simulation/SimulationPlanner';
import { ConnectionManager } from '../../src/db/ConnectionManager';
import { resolveSsl } from '../../src/db/ssl';

const URL_ENV = process.env.QG_TEST_DATABASE_URL;
const WORKER =
    process.env.QG_WORKER_PATH ?? path.join(__dirname, '..', '..', 'src', 'db', 'worker.js');

const FIXTURE = `
DROP SCHEMA IF EXISTS qg CASCADE;
CREATE SCHEMA qg;
CREATE TABLE qg."User" (id serial PRIMARY KEY, email text NOT NULL, "deletedAt" timestamptz);
CREATE TABLE qg."Post" (id serial PRIMARY KEY, "authorId" int NOT NULL REFERENCES qg."User"(id) ON DELETE CASCADE, title text);
CREATE TABLE qg."Comment" (id serial PRIMARY KEY, "postId" int REFERENCES qg."Post"(id) ON DELETE CASCADE);
CREATE TABLE qg.invoice (id serial PRIMARY KEY, user_id int REFERENCES qg."User"(id) ON DELETE RESTRICT);
CREATE TABLE qg.audit (id serial PRIMARY KEY, user_id int REFERENCES qg."User"(id) ON DELETE SET NULL);
CREATE TABLE qg.category (id serial PRIMARY KEY, parent_id int REFERENCES qg.category(id) ON DELETE CASCADE);
CREATE TABLE qg.tenant_user (tenant int, uid int, PRIMARY KEY (tenant, uid));
CREATE TABLE qg.tenant_note (id serial PRIMARY KEY, tenant int, uid int,
    FOREIGN KEY (tenant, uid) REFERENCES qg.tenant_user (tenant, uid) ON DELETE CASCADE);

INSERT INTO qg."User" (email, "deletedAt")
    SELECT 'u' || g || '@x.io', CASE WHEN g % 4 = 0 THEN now() END FROM generate_series(1, 40) g;
INSERT INTO qg."Post" ("authorId", title) SELECT 1 + (g % 40), 't' FROM generate_series(1, 400) g;
INSERT INTO qg."Comment" ("postId") SELECT 1 + (g % 400) FROM generate_series(1, 2000) g;
INSERT INTO qg.invoice (user_id) SELECT g FROM generate_series(30, 40) g;
INSERT INTO qg.audit (user_id) SELECT 1 + (g % 40) FROM generate_series(1, 100) g;
INSERT INTO qg.tenant_user SELECT 1, g FROM generate_series(1, 5) g;
INSERT INTO qg.tenant_note (tenant, uid) SELECT 1, 1 + (g % 5) FROM generate_series(1, 50) g;
ANALYZE;
`;

const TABLES = ['"User"', '"Post"', '"Comment"', 'invoice', 'audit'];

async function rowCounts(client: Client): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const t of TABLES) {
        out[t] = Number((await client.query(`SELECT count(*) AS n FROM qg.${t}`)).rows[0].n);
    }
    out.nulled = Number(
        (await client.query('SELECT count(*) AS n FROM qg.audit WHERE user_id IS NULL')).rows[0].n
    );
    return out;
}

(URL_ENV ? describe : describe.skip)('PostgreSQL integration (real worker)', function () {
    this.timeout(60_000);
    const url = URL_ENV ?? '';
    let admin: Client;
    let cm: ConnectionManager;
    let index: SchemaIndex;

    before(async () => {
        admin = new Client({ connectionString: url });
        await admin.connect();
        await admin.query(FIXTURE);
        cm = new ConnectionManager(WORKER);
        const ssl = resolveSsl(url, 'auto');
        await cm.connect(
            { id: 't', name: 'test' },
            { connectionString: ssl.connectionString, ssl: ssl.ssl, applicationName: 'qg-test' }
        );
        index = new SchemaIndex(await cm.fetchSchema());
    });

    after(async () => {
        await cm?.disconnect();
        await admin?.query('DROP SCHEMA IF EXISTS qg CASCADE');
        await admin?.end();
    });

    it('reads tables, columns, statistics and foreign keys from the catalog', () => {
        const user = index.get('qg', 'User');
        assert.ok(user);
        assert.deepStrictEqual(user.columns, ['id', 'email', 'deletedAt']);
        assert.strictEqual(user.rowEstimate, 40);
        const fks = index
            .referencing(user)
            .map((f) => `${f.table}(${f.columns.join(',')})→${f.onDelete}`)
            .sort();
        assert.deepStrictEqual(fks, [
            'Post(authorId)→CASCADE',
            'audit(user_id)→SET NULL',
            'invoice(user_id)→RESTRICT',
        ]);
        const composite = index.referencing(index.get('qg', 'tenant_user')!)[0];
        assert.deepStrictEqual(composite.columns, ['tenant', 'uid']);
        assert.deepStrictEqual(composite.refColumns, ['tenant', 'uid']);
        assert.ok(index.snapshot.searchPath.includes('public'));
    });

    async function simulate(code: string, supplied = new Map()) {
        const [mutation] = analyzeSource(code, 'a.ts', 'typescript', DEFAULT_DETECTOR_OPTIONS);
        const analysis = analyzeImpact(mutation, {
            index,
            project: new ProjectModel(),
            options: DEFAULT_IMPACT_OPTIONS,
            file: 'a.ts',
        });
        assert.ok(analysis.table, 'table should resolve');
        const plan = planSimulation(mutation, analysis.table, index, new ProjectModel(), supplied);
        const result = await cm.count({
            queries: plan.queries.map((q) => q.sql),
            params: plan.params,
            statementTimeoutMs: 5000,
        });
        return buildReport(plan, result.counts, result.durationMs, false);
    }

    /** Ground truth: really run the statement in a transaction we roll back. */
    async function groundTruth(sql: string, params: unknown[] = []) {
        await admin.query('BEGIN');
        try {
            const before = await rowCounts(admin);
            const res = await admin.query(sql, params);
            const after = await rowCounts(admin);
            return { affected: res.rowCount ?? 0, before, after };
        } finally {
            await admin.query('ROLLBACK');
        }
    }

    it('matches a real cascading DELETE exactly', async () => {
        const report = await simulate(`supabase.schema('qg').from('User').delete().eq('id', 5)`);
        const truth = await groundTruth('DELETE FROM qg."User" WHERE id = 5');
        assert.ok(report.ok);
        assert.strictEqual(report.exact, true);
        assert.strictEqual(report.baseRows, truth.affected);
        const realCascade =
            truth.before['"Post"'] -
            truth.after['"Post"'] +
            (truth.before['"Comment"'] - truth.after['"Comment"']);
        assert.strictEqual(report.cascadeDeletedRows, realCascade);
        assert.strictEqual(report.nullifiedRows, truth.after.nulled - truth.before.nulled);
        assert.deepStrictEqual(report.blockedBy, []);
    });

    it('predicts a RESTRICT failure that really happens', async () => {
        const report = await simulate(`supabase.schema('qg').from('User').delete().eq('id', 35)`);
        assert.deepStrictEqual(report.blockedBy, [{ table: 'qg.invoice', rows: 1 }]);
        await assert.rejects(
            groundTruth('DELETE FROM qg."User" WHERE id = 35'),
            /violates foreign key/
        );
    });

    it('counts IS NULL filters and runtime values supplied by the user', async () => {
        const report = await simulate(
            `supabase.schema('qg').from('User').delete().is('deletedAt', null).eq('email', email)`,
            new Map([[1, 'u1@x.io']])
        );
        const truth = await groundTruth(
            `DELETE FROM qg."User" WHERE "deletedAt" IS NULL AND email = 'u1@x.io'`
        );
        assert.strictEqual(report.baseRows, truth.affected);
        assert.strictEqual(report.baseRows, 1);
    });

    it('follows composite foreign keys', async () => {
        const report = await simulate(
            `supabase.schema('qg').from('tenant_user').delete().eq('uid', 2)`
        );
        const res = await admin.query('SELECT count(*) AS n FROM qg.tenant_note WHERE uid = 2');
        assert.strictEqual(report.cascadeDeletedRows, Number(res.rows[0].n));
    });

    it('handles self-referencing foreign keys without looping', async () => {
        const report = await simulate(
            `supabase.schema('qg').from('category').delete().eq('id', 1)`
        );
        assert.ok(report.ok);
        assert.ok(report.warnings.some((w) => w.includes('Self-referencing')));
        assert.strictEqual(report.exact, true);
        assert.strictEqual(report.cascadeApproximate, true);
    });

    it('cannot modify data: writes are rejected by the READ ONLY transaction', async () => {
        const before = await rowCounts(admin);
        await assert.rejects(
            cm.count({
                queries: [
                    'WITH d AS (DELETE FROM qg.audit RETURNING 1) SELECT count(*) AS n FROM d',
                ],
                params: [],
                statementTimeoutMs: 5000,
            }),
            /read-only/
        );
        assert.deepStrictEqual(await rowCounts(admin), before);
        assert.ok(cm.isConnected, 'a rejected statement must not drop the connection');
    });

    it('enforces the server-side statement timeout', async () => {
        await assert.rejects(
            cm.count({
                queries: ['SELECT count(*) AS n FROM pg_sleep(3)'],
                params: [],
                statementTimeoutMs: 200,
            }),
            /timeout/i
        );
        const after = await cm.count({
            queries: ['SELECT 1 AS n'],
            params: [],
            statementTimeoutMs: 1000,
        });
        assert.deepStrictEqual(after.counts, [1]);
    });

    it('reports authentication errors in plain language', async () => {
        const bad = new URL(url);
        bad.password = 'wrong-password';
        const other = new ConnectionManager(WORKER);
        await assert.rejects(
            other.connect(
                { id: 'x', name: 'bad' },
                { connectionString: bad.toString(), ssl: false, applicationName: 'qg-test' }
            ),
            /Authentication failed/
        );
        assert.strictEqual(other.state.status, 'disconnected');
        other.dispose();
    });

    it('explains a TLS mismatch', async () => {
        const other = new ConnectionManager(WORKER);
        await assert.rejects(
            other.connect(
                { id: 'x', name: 'tls' },
                {
                    connectionString: url,
                    ssl: { rejectUnauthorized: false },
                    applicationName: 'qg-test',
                }
            ),
            /does not support SSL/
        );
        other.dispose();
    });
});
