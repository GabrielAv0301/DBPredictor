import * as assert from 'assert';
import { SupabaseDetector } from '../../src/core/detectors/SupabaseDetector';
import { MockDocument } from './vscode.mock';

describe('SupabaseDetector Unit Tests', () => {
    const detector = new SupabaseDetector();

    it('Should detect delete with eq filter', () => {
        const doc = new MockDocument('supabase.from(\'users\').delete().eq(\'active\', false)');
        const results = detector.detect(doc);
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].table, 'users');
        assert.strictEqual(results[0].hasWhere, true);
        assert.ok(results[0].queryParams?.some((p) => p.column === 'active' && p.value === false));
    });

    it('Should detect update without filter (dangerous)', () => {
        const doc = new MockDocument('supabase.from(\'logs\').update({ archived: true })');
        const results = detector.detect(doc);
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].table, 'logs');
        assert.strictEqual(results[0].hasWhere, false);
    });

    it('Should detect complex chains', () => {
        const doc = new MockDocument(
            'supabase.from(\'posts\').delete().match({ author_id: 1, category: \'spam\' })'
        );
        const results = detector.detect(doc);
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].table, 'posts');
        assert.strictEqual(results[0].hasWhere, true);
        assert.ok(results[0].queryParams?.some((p) => p.column === 'author_id' && p.value === 1));
        assert.ok(
            results[0].queryParams?.some((p) => p.column === 'category' && p.value === 'spam')
        );
    });
});
