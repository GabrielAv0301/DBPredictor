import * as assert from 'assert';
import { DrizzleDetector } from '../../src/core/detectors/DrizzleDetector';
import { MockDocument } from './vscode.mock';

describe('DrizzleDetector Unit Tests', () => {
    const detector = new DrizzleDetector();

    it('should detect simple delete without where', () => {
        const code = 'await db.delete(usersTable);';
        const doc = new MockDocument(code);
        const results = detector.detect(doc);

        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].table, 'usersTable');
        assert.strictEqual(results[0].operation, 'deleteMany');
        assert.strictEqual(results[0].hasWhere, false);
    });

    it('should detect update with where clause and extract params', () => {
        const code =
            'await db.update(postsTable).set({ title: \'New\' }).where(eq(postsTable.id, 1));';
        const doc = new MockDocument(code);
        const results = detector.detect(doc);

        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].table, 'postsTable');
        assert.strictEqual(results[0].operation, 'updateMany');
        assert.strictEqual(results[0].hasWhere, true);
        assert.ok(results[0].queryParams?.some((p) => p.column === 'id' && p.value === 1));
    });

    it('should NOT detect calls where root is not db', () => {
        const code = `
            const myClient = { delete: (t) => {} };
            await myClient.delete(users); // Should be ignored
        `;
        const doc = new MockDocument(code);
        const results = detector.detect(doc);

        assert.strictEqual(results.length, 0);
    });

    it('should detect drizzle raw queries and extract table name', () => {
        const code = 'await db.execute(\'DELETE FROM users\');';
        const doc = new MockDocument(code);
        const results = detector.detect(doc);

        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].table, 'users');
        assert.strictEqual(results[0].operation, 'updateMany');
    });
});
