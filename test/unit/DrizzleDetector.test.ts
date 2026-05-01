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

    it('should detect update with where clause', () => {
        const code =
            'await db.update(postsTable).set({ title: \'New\' }).where(eq(postsTable.id, 1));';
        const doc = new MockDocument(code);
        const results = detector.detect(doc);

        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].table, 'postsTable');
        assert.strictEqual(results[0].operation, 'updateMany');
        assert.strictEqual(results[0].hasWhere, true);
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

    it('should extract queryParams from .where(eq()) clauses', () => {
        const code = 'await db.delete(usersTable).where(eq(usersTable.id, 42));';
        const doc = new MockDocument(code);
        const results = detector.detect(doc);

        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].hasWhere, true);
        assert.strictEqual(results[0].operation, 'deleteMany');
        const params = results[0].queryParams || [];
        assert.ok(params.some((p: { column: string, value: unknown }) => p.column === 'id' && p.value === 42));
    });

    it('should extract multiple params from .where(and(...))', () => {
        const code = 'await db.update(postsTable).where(and(eq(postsTable.status, \'draft\'), eq(postsTable.authorId, 5)));';
        const doc = new MockDocument(code);
        const results = detector.detect(doc);

        assert.strictEqual(results.length, 1);
        const params = results[0].queryParams || [];
        assert.ok(params.some((p: { column: string, value: unknown }) => p.column === 'status' && p.value === 'draft'));
        assert.ok(params.some((p: { column: string, value: unknown }) => p.column === 'authorId' && p.value === 5));
    });

    it('should detect db.update().set().where() full chain', () => {
        const code = 'await db.update(usersTable).set({ active: false }).where(eq(usersTable.id, 1));';
        const doc = new MockDocument(code);
        const results = detector.detect(doc);

        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].table, 'usersTable');
        assert.strictEqual(results[0].operation, 'updateMany');
        assert.strictEqual(results[0].hasWhere, true);
        assert.ok(results[0].queryParams?.some((p: { column: string, value: unknown }) => p.column === 'id' && p.value === 1));
    });
});
