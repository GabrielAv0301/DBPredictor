import * as assert from 'assert';
import { detect, detectOne } from '../helpers';

describe('Supabase detection', () => {
    it('detects delete without filters', () => {
        const m = detectOne(`await supabase.from('profiles').delete();`);
        assert.strictEqual(m.orm, 'supabase');
        assert.strictEqual(m.operation, 'deleteMany');
        assert.deepStrictEqual(m.table, { kind: 'sql-name', name: 'profiles', schema: undefined });
        assert.strictEqual(m.hasWhere, false);
    });

    it('extracts eq / in / is filters and keeps neutral modifiers', () => {
        const m = detectOne(
            `supabase.from('todos').delete().eq('user_id', uid).in('status', ['done']).is('archived_at', null).select()`
        );
        assert.strictEqual(m.hasWhere, true);
        assert.strictEqual(m.filtersComplete, true);
        assert.deepStrictEqual(m.filters, [
            { field: 'user_id', operator: 'eq', value: { kind: 'expression', text: 'uid' } },
            { field: 'status', operator: 'in', value: { kind: 'literal', value: ['done'] } },
            { field: 'archived_at', operator: 'isNull' },
        ]);
    });

    it('counts other filters (lt, or…) as filtered but incomplete', () => {
        const m = detectOne(
            `supabase.from('logs').delete().lt('created_at', cutoff).or('a.eq.1,b.eq.2')`
        );
        assert.strictEqual(m.hasWhere, true);
        assert.strictEqual(m.filtersComplete, false);
        assert.strictEqual(m.filters.length, 1);
    });

    it('supports match() and update()', () => {
        const m = detectOne(
            `supabase.from('users').update({ active: false }).match({ org_id: 3, role: 'guest' })`
        );
        assert.strictEqual(m.operation, 'updateMany');
        assert.strictEqual(m.filters.length, 2);
    });

    it('treats match({}) as no filter (audit #5)', () => {
        assert.strictEqual(detectOne(`supabase.from('a').delete().match({})`).hasWhere, false);
    });

    it('reads schema()', () => {
        const m = detectOne(`supabase.schema('billing').from('invoices').delete().eq('id', 1)`);
        assert.deepStrictEqual(m.table, { kind: 'sql-name', name: 'invoices', schema: 'billing' });
    });

    it('reports a chain once', () => {
        assert.strictEqual(detect(`supabase.from('a').delete().eq('id', 1).eq('b', 2)`).length, 1);
    });

    it('ignores select / insert and dynamic table names', () => {
        assert.deepStrictEqual(detect(`supabase.from('a').select().eq('id', 1)`), []);
        assert.deepStrictEqual(detect(`supabase.from('a').insert({})`), []);
        assert.deepStrictEqual(detect(`supabase.from(tableName).delete()`), []);
    });
});
