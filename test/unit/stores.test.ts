import * as assert from 'assert';
import { csvCell, HistoryStore, MAX_HISTORY } from '../../src/services/HistoryStore';
import { ProfileStore } from '../../src/services/ProfileStore';
import type { ImpactSummary } from '../../src/shared/types';
import { Logger, redact } from '../../src/utils/logger';
import { MemorySecrets, MemoryStore } from '../helpers';

function newProfiles() {
    const global = new MemoryStore();
    const workspace = new MemoryStore();
    const secrets = new MemorySecrets();
    return { global, workspace, secrets, store: new ProfileStore(global, workspace, secrets) };
}

describe('ProfileStore', () => {
    it('keeps the connection string only in secret storage', async () => {
        const { global, secrets, store } = newProfiles();
        const p = await store.create('Prod', 'postgresql://u:hunter2@db:5432/app');
        const serialized = JSON.stringify([...global.data.values()]);
        assert.ok(!serialized.includes('hunter2'));
        assert.strictEqual(p.target, 'u@db:5432/app');
        assert.strictEqual(
            await store.getConnectionString(p.id),
            'postgresql://u:hunter2@db:5432/app'
        );
        assert.strictEqual(secrets.data.size, 1);
    });

    it('rejects duplicate names and deletes secrets with the profile', async () => {
        const { secrets, store } = newProfiles();
        const p = await store.create('Local', 'postgresql://localhost/db');
        await assert.rejects(store.create('local', 'postgresql://localhost/db'), /already exists/);
        await store.setActive(p.id);
        await store.delete(p.id);
        assert.strictEqual(secrets.data.size, 0);
        assert.strictEqual(store.activeId, undefined);
    });

    it('migrates 1.x plain-text profiles and removes them', async () => {
        const { global, workspace, secrets, store } = newProfiles();
        await global.update('queryguard.connectionProfiles', [
            {
                name: 'Staging',
                connectionString: 'postgresql://u:pw1@staging/db',
                sslMode: 'auto',
                createdAt: 1,
            },
            {
                name: 'Prod',
                connectionString: 'postgresql://u:pw2@prod/db',
                sslMode: 'auto',
                createdAt: 2,
            },
        ]);
        await global.update('queryguard.history', [{ old: true }]);
        await secrets.store('queryguard.connectionString', 'postgresql://u:pw2@prod/db');

        assert.strictEqual(await store.migrateLegacy(), 2);
        assert.deepStrictEqual(
            store.list().map((p) => p.name),
            ['Staging', 'Prod']
        );
        assert.strictEqual(global.get('queryguard.connectionProfiles'), undefined);
        assert.strictEqual(global.get('queryguard.history'), undefined);
        assert.strictEqual(await secrets.get('queryguard.connectionString'), undefined);
        assert.strictEqual(store.get(store.activeId!)?.name, 'Prod');
        assert.ok(
            !JSON.stringify([...global.data.values(), ...workspace.data.values()]).includes('pw')
        );
        // Idempotent
        assert.strictEqual(await store.migrateLegacy(), 0);
    });

    it('migrates a lone legacy active connection', async () => {
        const { secrets, store } = newProfiles();
        await secrets.store('queryguard.connectionString', 'postgresql://u:p@h/db');
        assert.strictEqual(await store.migrateLegacy(), 1);
        assert.strictEqual(store.list()[0].name, 'Default');
        assert.strictEqual(store.activeId, store.list()[0].id);
    });
});

function impact(key: string, overrides: Partial<ImpactSummary> = {}): ImpactSummary {
    return {
        key,
        orm: 'prisma',
        operation: 'deleteMany',
        tableInCode: 'user',
        table: 'public.User',
        connected: true,
        hasWhere: false,
        filtersComplete: true,
        filters: [],
        tableRows: 10,
        statsAnalyzedAt: null,
        baseRows: 10,
        baseEstimate: 'estimated',
        cascadeDeletedRows: 0,
        nullifiedRows: 0,
        totalRows: 10,
        cascade: [],
        blockers: [],
        riskLevel: 'DESTRUCTIVE',
        reasons: [],
        file: 'src/a.ts',
        line: 0,
        sourceText: 'prisma.user.deleteMany()',
        ...overrides,
    };
}

describe('HistoryStore', () => {
    it('deduplicates by mutation and caps the size', async () => {
        const history = new HistoryStore(new MemoryStore());
        await history.record(impact('a'));
        await history.record(impact('a'));
        assert.strictEqual(history.list().length, 1);
        for (let i = 0; i < MAX_HISTORY + 5; i++) await history.record(impact(`k${i}`));
        assert.strictEqual(history.list().length, MAX_HISTORY);
    });

    it('exports CSV safely', async () => {
        const history = new HistoryStore(new MemoryStore());
        await history.record(impact('a', { file: '=cmd|calc.ts', filters: ['name = \'a,"b"\''] }));
        const csv = history.toCSV();
        assert.ok(csv.includes(`,'=cmd|calc.ts,`));
        assert.ok(csv.includes('"name = \'a,""b""\'"'));
        assert.strictEqual(csvCell(-5), '-5');
        assert.strictEqual(csvCell('-5'), "'-5");
    });
});

describe('Logger', () => {
    afterEach(() => Logger.setSink(undefined));

    it('redacts connection strings and passwords everywhere', () => {
        const lines: string[] = [];
        const sink = {
            info: (m: string) => lines.push(m),
            warn: () => {},
            error: () => {},
            debug: () => {},
        };
        Logger.setSink(sink);
        Logger.info('Connecting to postgresql://u:secret@host/db', {
            password: 'x',
            connectionString: 'y',
            ok: 1,
        });
        assert.ok(!lines[0].includes('secret'));
        assert.ok(lines[0].includes('[REDACTED]'));
        assert.ok(lines[0].includes('"ok":1'));
        assert.strictEqual(redact('password=abc host=x'), 'password=*** host=x');
    });
});
