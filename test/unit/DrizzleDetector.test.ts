import * as assert from 'assert';
import * as vscode from 'vscode';
import { DrizzleDetector } from '../../src/core/detectors/DrizzleDetector';

// Mock simple de TextDocument para testing
class MockDocument {
    constructor(private content: string, public fileName: string = 'test.ts') {}
    getText() { return this.content; }
    positionAt(offset: number) {
        const lines = this.content.substring(0, offset).split('\n');
        return new vscode.Position(lines.length - 1, lines[lines.length - 1].length);
    }
    uri = { toString: () => 'file://' + this.fileName };
}

describe('DrizzleDetector Unit Tests', () => {
    const detector = new DrizzleDetector();

    it('should detect simple delete without where', () => {
        const code = `await db.delete(usersTable);`;
        const doc = new MockDocument(code) as any as vscode.TextDocument;
        const results = detector.detect(doc);

        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].table, 'usersTable');
        assert.strictEqual(results[0].operation, 'deleteMany');
        assert.strictEqual(results[0].hasWhere, false);
    });

    it('should detect update with where clause', () => {
        const code = `await db.update(postsTable).set({ title: 'New' }).where(eq(postsTable.id, 1));`;
        const doc = new MockDocument(code) as any as vscode.TextDocument;
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
        const doc = new MockDocument(code) as any as vscode.TextDocument;
        const results = detector.detect(doc);

        assert.strictEqual(results.length, 0);
    });
});
