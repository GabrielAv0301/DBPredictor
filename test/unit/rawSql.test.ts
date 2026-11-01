import * as assert from 'assert';
import { classifyRawSql } from '../../src/core/sql/rawSql';

describe('classifyRawSql', () => {
    it('ignores read-only statements', () => {
        assert.strictEqual(classifyRawSql('SELECT * FROM users WHERE id = $1'), null);
        assert.strictEqual(classifyRawSql('INSERT INTO users (name) VALUES ($1)'), null);
        assert.strictEqual(classifyRawSql('SELECT * FROM jobs FOR UPDATE SKIP LOCKED'), null);
    });

    it('detects DELETE with and without WHERE', () => {
        assert.deepStrictEqual(classifyRawSql('DELETE FROM users'), {
            operation: 'deleteMany',
            table: 'users',
            schema: undefined,
            hasWhere: false,
            truncateCascade: false,
        });
        const filtered = classifyRawSql('delete from "public"."Users" where id = $1');
        assert.strictEqual(filtered?.table, 'Users');
        assert.strictEqual(filtered?.schema, 'public');
        assert.strictEqual(filtered?.hasWhere, true);
    });

    it('detects UPDATE … SET', () => {
        const r = classifyRawSql('UPDATE ONLY accounts SET balance = 0');
        assert.strictEqual(r?.operation, 'updateMany');
        assert.strictEqual(r?.table, 'accounts');
        assert.strictEqual(r?.hasWhere, false);
    });

    it('detects TRUNCATE and CASCADE', () => {
        const r = classifyRawSql('TRUNCATE TABLE audit.logs CASCADE');
        assert.strictEqual(r?.operation, 'truncate');
        assert.strictEqual(r?.schema, 'audit');
        assert.strictEqual(r?.truncateCascade, true);
    });

    it('ignores keywords inside comments and string literals', () => {
        assert.strictEqual(
            classifyRawSql("SELECT 'DELETE FROM users' AS x -- DELETE FROM users"),
            null
        );
        assert.strictEqual(classifyRawSql('/* UPDATE users SET a = 1 */ SELECT 1'), null);
    });

    it('treats an interpolated table name as unknown', () => {
        const r = classifyRawSql('DELETE FROM $1 WHERE id = $2');
        assert.strictEqual(r?.table, null);
    });

    it('returns the most dangerous statement of a script', () => {
        const r = classifyRawSql('UPDATE a SET x = 1 WHERE id = 2; DELETE FROM b;');
        assert.strictEqual(r?.operation, 'deleteMany');
        assert.strictEqual(r?.table, 'b');
    });

    it('ignores WHERE inside sub-queries and dollar-quoted strings (audit #2)', () => {
        const sub = classifyRawSql(
            'UPDATE users SET score = (SELECT max(s) FROM scores WHERE scores.uid = users.id)'
        );
        assert.strictEqual(sub?.hasWhere, false);
        assert.strictEqual(classifyRawSql('UPDATE users SET bio = $$ where $$')?.hasWhere, false);
        assert.strictEqual(
            classifyRawSql('UPDATE users SET a = (SELECT 1) WHERE id = 1')?.hasWhere,
            true
        );
    });

    it('reports an unfiltered DELETE hidden in a data-modifying CTE (audit #3)', () => {
        const r = classifyRawSql(
            'WITH d AS (DELETE FROM sessions RETURNING id) UPDATE users SET x = 1 WHERE id = 1'
        );
        assert.strictEqual(r?.operation, 'deleteMany');
        assert.strictEqual(r?.table, 'sessions');
        assert.strictEqual(r?.hasWhere, false);
    });

    it('does not mistake FOR UPDATE SKIP LOCKED for an UPDATE (audit #4)', () => {
        const r = classifyRawSql(
            'WITH c AS (SELECT id FROM jobs WHERE state = 1 LIMIT 10 FOR UPDATE SKIP LOCKED) UPDATE jobs SET state = 2 FROM c WHERE jobs.id = c.id'
        );
        assert.strictEqual(r?.table, 'jobs');
        assert.strictEqual(r?.hasWhere, true);
    });

    it('finds mutations inside CTEs', () => {
        const r = classifyRawSql(
            'WITH gone AS (DELETE FROM sessions WHERE expires < now() RETURNING id) SELECT count(*) FROM gone'
        );
        assert.strictEqual(r?.operation, 'deleteMany');
        assert.strictEqual(r?.table, 'sessions');
        assert.strictEqual(r?.hasWhere, true);
    });
});
