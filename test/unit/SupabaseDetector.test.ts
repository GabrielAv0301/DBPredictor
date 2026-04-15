import * as assert from 'assert';
import * as vscode from 'vscode';
import { SupabaseDetector } from '../../src/core/detectors/SupabaseDetector';

// Simple mock for TextDocument
class MockDocument {
    constructor(public text: string, public fileName: string = 'test.ts') {}
    getText() { return this.text; }
    positionAt(offset: number) {
        return new vscode.Position(0, 0);
    }
}

describe('SupabaseDetector Unit Tests', () => {
    const detector = new SupabaseDetector();

    it('Should detect delete with eq filter', () => {
        const doc = new MockDocument("supabase.from('users').delete().eq('active', false)") as any;
        const results = detector.detect(doc);
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].table, 'users');
        assert.strictEqual(results[0].hasWhere, true);
        assert.ok(results[0].queryParams?.some(p => p.column === 'active' && p.value === false));
    });

    it('Should detect update without filter (dangerous)', () => {
        const doc = new MockDocument("supabase.from('logs').update({ archived: true })") as any;
        const results = detector.detect(doc);
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].table, 'logs');
        assert.strictEqual(results[0].hasWhere, false);
    });

    it('Should detect complex chains', () => {
        const doc = new MockDocument("supabase.from('posts').delete().match({ author_id: 1, category: 'spam' })") as any;
        const results = detector.detect(doc);
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].table, 'posts');
        assert.strictEqual(results[0].hasWhere, true);
        assert.ok(results[0].queryParams?.some(p => p.column === 'author_id' && p.value === 1));
        assert.ok(results[0].queryParams?.some(p => p.column === 'category' && p.value === 'spam'));
    });
});
